//! Envelope filter rules.
//!
//! Filters inspect and optionally transform `RouteEnvelope` values as they
//! pass through the forward engine. Each filter returns a `FilterDecision`
//! that determines whether the envelope is allowed, dropped, or modified.
//!
//! Built-in filters:
//! - `TtlFilter` — drops envelopes with TTL exhausted.
//! - `DomainWhitelistFilter` — drops envelopes whose target domain is not in
//!   the whitelist.
//!
//! Custom filters can be added by implementing [`FilterRule`].

use glassvein_protocol::RouteEnvelope;

use crate::route::NextHop;
use crate::route::RouteEntry;

// ── FilterContext ────────────────────────────────────────────────────

/// Context provided to each filter during evaluation.
#[derive(Clone, Debug)]
pub struct FilterContext {
    /// The router node evaluating this filter.
    pub router_id: String,
    /// The next-hop the envelope arrived from (if known).
    pub source_hop: Option<NextHop>,
    /// The route entry selected for forwarding (if a route was found).
    pub route_entry: Option<RouteEntry>,
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
    ///
    /// `envelope` is mutable to allow in-place transformations.
    fn apply(&self, envelope: &mut RouteEnvelope, context: &FilterContext) -> FilterDecision;
}

// ── Built-in: TtlFilter ─────────────────────────────────────────────

/// Drops envelopes whose TTL is zero (already exhausted before reaching
/// this router). The forward engine normally decrements TTL and checks
/// for exhaustion before calling filters, so this filter is a safety net.
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

    fn apply(&self, envelope: &mut RouteEnvelope, _context: &FilterContext) -> FilterDecision {
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

    fn apply(&self, envelope: &mut RouteEnvelope, _context: &FilterContext) -> FilterDecision {
        if self.allowed_domains.is_empty() {
            return FilterDecision::Allow;
        }
        if self
            .allowed_domains
            .iter()
            .any(|d| d == &envelope.target.domain_id)
        {
            FilterDecision::Allow
        } else {
            FilterDecision::Drop(format!(
                "target domain '{}' not in whitelist",
                envelope.target.domain_id
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

    fn apply(&self, envelope: &mut RouteEnvelope, _context: &FilterContext) -> FilterDecision {
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
    use glassvein_protocol::RouteAddress;

    fn test_envelope(ttl: u8) -> RouteEnvelope {
        let mut env = RouteEnvelope::new(
            RouteAddress::domain("src"),
            RouteAddress::new("target-domain", Some("rt"), Some("ses")),
            "test.kind",
            serde_json::json!({}),
        );
        env.ttl = ttl;
        env
    }

    fn test_context() -> FilterContext {
        FilterContext {
            router_id: "test-router".into(),
            source_hop: None,
            route_entry: None,
        }
    }

    // -- TtlFilter --

    #[test]
    fn ttl_filter_allows_above_min() {
        let filter = TtlFilter::new(0);
        let mut env = test_envelope(5);
        assert_eq!(
            filter.apply(&mut env, &test_context()),
            FilterDecision::Allow
        );
    }

    #[test]
    fn ttl_filter_drops_at_min() {
        let filter = TtlFilter::new(0);
        let mut env = test_envelope(0);
        match filter.apply(&mut env, &test_context()) {
            FilterDecision::Drop(reason) => assert!(reason.contains("ttl")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    #[test]
    fn ttl_filter_custom_min() {
        let filter = TtlFilter::new(3);
        let mut env = test_envelope(3);
        match filter.apply(&mut env, &test_context()) {
            FilterDecision::Drop(_) => {}
            other => panic!("expected Drop, got: {:?}", other),
        }

        let mut env = test_envelope(4);
        assert_eq!(
            filter.apply(&mut env, &test_context()),
            FilterDecision::Allow
        );
    }

    // -- DomainWhitelistFilter --

    #[test]
    fn domain_whitelist_empty_allows_all() {
        let filter = DomainWhitelistFilter::new(vec![]);
        let mut env = test_envelope(5);
        assert_eq!(
            filter.apply(&mut env, &test_context()),
            FilterDecision::Allow
        );
    }

    #[test]
    fn domain_whitelist_allows_matching() {
        let filter = DomainWhitelistFilter::new(vec!["target-domain".into()]);
        let mut env = test_envelope(5);
        assert_eq!(
            filter.apply(&mut env, &test_context()),
            FilterDecision::Allow
        );
    }

    #[test]
    fn domain_whitelist_drops_non_matching() {
        let filter = DomainWhitelistFilter::new(vec!["other-domain".into()]);
        let mut env = test_envelope(5);
        match filter.apply(&mut env, &test_context()) {
            FilterDecision::Drop(reason) => {
                assert!(reason.contains("target-domain"));
            }
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    // -- KindBlockFilter --

    #[test]
    fn kind_block_allows_non_blocked() {
        let filter = KindBlockFilter::new(vec!["blocked.kind".into()]);
        let mut env = test_envelope(5);
        assert_eq!(
            filter.apply(&mut env, &test_context()),
            FilterDecision::Allow
        );
    }

    #[test]
    fn kind_block_drops_blocked() {
        let filter = KindBlockFilter::new(vec!["test.kind".into()]);
        let mut env = test_envelope(5);
        match filter.apply(&mut env, &test_context()) {
            FilterDecision::Drop(reason) => assert!(reason.contains("test.kind")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }
}
