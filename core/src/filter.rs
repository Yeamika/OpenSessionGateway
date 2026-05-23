//! Envelope filter rules.
//!
//! Filters inspect and optionally transform `SessionEnvelope` values as they
//! pass through the forward engine. Each filter returns a `FilterDecision`
//! that determines whether the envelope is allowed, dropped, or modified.
//!
//! Built-in filters:
//! - `TtlFilter` — drops envelopes with TTL at or below a threshold.
//! - `DomainWhitelistFilter` — drops envelopes whose target domain is not
//!   in the whitelist.
//! - `KindBlockFilter` — blocks envelopes by `kind` string.

use osgp::SessionEnvelope;

// ── FilterContext ────────────────────────────────────────────────────

/// Context provided to each filter during evaluation.
#[derive(Clone, Debug)]
pub struct FilterContext {
    /// The router node evaluating this filter.
    pub router_id: String,
    /// The neighbor the envelope arrived from (if known).
    pub source_neighbor: Option<String>,
}

// ── FilterDecision ──────────────────────────────────────────────────

/// Decision returned by a filter after inspecting an envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FilterDecision {
    /// Allow the envelope to continue through the pipeline.
    Allow,
    /// Drop the envelope with a reason.
    Drop(String),
    /// The envelope was modified in place; allow it to continue.
    Transform,
}

// ── FilterRule trait ────────────────────────────────────────────────

/// A filter that inspects and optionally transforms envelopes.
///
/// Filters are applied in order; the first filter that returns
/// `FilterDecision::Drop` terminates the pipeline.
pub trait FilterRule: Send + Sync + std::fmt::Debug {
    /// Unique name for the filter (used in diagnostics and tap events).
    fn name(&self) -> &str;

    /// Evaluate the filter against an envelope.
    fn apply(&self, envelope: &mut SessionEnvelope, context: &FilterContext) -> FilterDecision;
}

// ── Built-in: TtlFilter ─────────────────────────────────────────────

/// Drops envelopes whose TTL is at or below the minimum.
#[derive(Clone, Debug, Default)]
pub struct TtlFilter {
    pub min_ttl: u8,
}

impl TtlFilter {
    pub fn new(min_ttl: u8) -> Self {
        Self { min_ttl }
    }
}

impl FilterRule for TtlFilter {
    fn name(&self) -> &str {
        "ttl_filter"
    }

    fn apply(&self, envelope: &mut SessionEnvelope, _context: &FilterContext) -> FilterDecision {
        if envelope.ttl <= self.min_ttl {
            FilterDecision::Drop(format!("ttl {} <= min_ttl {}", envelope.ttl, self.min_ttl))
        } else {
            FilterDecision::Allow
        }
    }
}

// ── Built-in: DomainWhitelistFilter ─────────────────────────────────

/// Drops envelopes whose target domain is not in the whitelist.
/// An empty whitelist means "allow all" (no filtering).
#[derive(Clone, Debug)]
pub struct DomainWhitelistFilter {
    pub allowed_domains: Vec<String>,
}

impl DomainWhitelistFilter {
    pub fn new(allowed_domains: Vec<String>) -> Self {
        Self { allowed_domains }
    }
}

impl FilterRule for DomainWhitelistFilter {
    fn name(&self) -> &str {
        "domain_whitelist"
    }

    fn apply(&self, envelope: &mut SessionEnvelope, _context: &FilterContext) -> FilterDecision {
        if self.allowed_domains.is_empty() {
            return FilterDecision::Allow;
        }
        if self
            .allowed_domains
            .iter()
            .any(|d| d == &envelope.target.domain)
        {
            FilterDecision::Allow
        } else {
            FilterDecision::Drop(format!(
                "target domain '{}' not in whitelist",
                envelope.target.domain
            ))
        }
    }
}

// ── Built-in: KindBlockFilter ───────────────────────────────────────

/// Blocks envelopes whose `kind` field matches any entry in the blocklist.
#[derive(Clone, Debug)]
pub struct KindBlockFilter {
    pub blocked_kinds: Vec<String>,
}

impl KindBlockFilter {
    pub fn new(blocked_kinds: Vec<String>) -> Self {
        Self { blocked_kinds }
    }
}

impl FilterRule for KindBlockFilter {
    fn name(&self) -> &str {
        "kind_block"
    }

    fn apply(&self, envelope: &mut SessionEnvelope, _context: &FilterContext) -> FilterDecision {
        if self.blocked_kinds.iter().any(|k| k == &envelope.kind) {
            FilterDecision::Drop(format!("blocked kind '{}'", envelope.kind))
        } else {
            FilterDecision::Allow
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use osgp::SessionAddress;

    fn test_envelope(ttl: u8, target_domain: &str, kind: &str) -> SessionEnvelope {
        let mut env = SessionEnvelope::new(
            SessionAddress::new("src", None, None),
            SessionAddress::new(target_domain, Some("rt".into()), Some("ses".into())),
            kind,
            json!({}),
        );
        env.ttl = ttl;
        env
    }

    fn ctx() -> FilterContext {
        FilterContext {
            router_id: "test-router".into(),
            source_neighbor: None,
        }
    }

    #[test]
    fn ttl_filter_allows_above_min() {
        let f = TtlFilter::new(0);
        let mut env = test_envelope(5, "d1", "test");
        assert_eq!(f.apply(&mut env, &ctx()), FilterDecision::Allow);
    }

    #[test]
    fn ttl_filter_drops_at_min() {
        let f = TtlFilter::new(0);
        let mut env = test_envelope(0, "d1", "test");
        match f.apply(&mut env, &ctx()) {
            FilterDecision::Drop(r) => assert!(r.contains("ttl")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    #[test]
    fn domain_whitelist_empty_allows_all() {
        let f = DomainWhitelistFilter::new(vec![]);
        let mut env = test_envelope(5, "any", "test");
        assert_eq!(f.apply(&mut env, &ctx()), FilterDecision::Allow);
    }

    #[test]
    fn domain_whitelist_allows_matching() {
        let f = DomainWhitelistFilter::new(vec!["allowed".into()]);
        let mut env = test_envelope(5, "allowed", "test");
        assert_eq!(f.apply(&mut env, &ctx()), FilterDecision::Allow);
    }

    #[test]
    fn domain_whitelist_drops_non_matching() {
        let f = DomainWhitelistFilter::new(vec!["other".into()]);
        let mut env = test_envelope(5, "blocked", "test");
        match f.apply(&mut env, &ctx()) {
            FilterDecision::Drop(r) => assert!(r.contains("blocked")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    #[test]
    fn kind_block_allows_non_blocked() {
        let f = KindBlockFilter::new(vec!["blocked.kind".into()]);
        let mut env = test_envelope(5, "d1", "safe.kind");
        assert_eq!(f.apply(&mut env, &ctx()), FilterDecision::Allow);
    }

    #[test]
    fn kind_block_drops_blocked() {
        let f = KindBlockFilter::new(vec!["evil.kind".into()]);
        let mut env = test_envelope(5, "d1", "evil.kind");
        match f.apply(&mut env, &ctx()) {
            FilterDecision::Drop(r) => assert!(r.contains("evil.kind")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }
}
