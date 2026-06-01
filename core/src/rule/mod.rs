//! Rule table — priority-ordered forwarding rules evaluated before route
//! resolution.
//!
//! Rules use protocol-level matchers (source/target address, link_type,
//! subtype, kind, from_neighbor, ttl range) and produce actions (Drop,
//! ForceNeighbor, DenyNeighbor, Continue). The first matching enabled rule
//! wins.

#[cfg(test)]
mod tests;
mod types;

use osgp::SessionAddress;

pub use types::{Rule, RuleAction, RuleContext, RuleMatcher, RuleSnapshotEntry};

// ── RuleTable ───────────────────────────────────────────────────────

/// A table of forwarding rules sorted by priority.
#[derive(Debug, Default, Clone)]
pub struct RuleTable {
    rules: Vec<Rule>,
    revision: u64,
}

impl RuleTable {
    // ── Mutation ───────────────────────────────────────────────────

    /// Add or replace a rule. If a rule with the same ID exists, it is
    /// replaced. Rules are kept sorted by priority after insertion.
    pub fn add_rule(&mut self, rule: Rule) {
        if let Some(pos) = self.rules.iter().position(|r| r.id == rule.id) {
            self.rules[pos] = rule;
        } else {
            self.rules.push(rule);
        }
        self.rules.sort_by_key(|r| r.priority);
        self.bump_revision();
    }

    /// Remove a rule by ID. Returns `true` if it existed.
    pub fn remove_rule(&mut self, id: &str) -> bool {
        let before = self.rules.len();
        self.rules.retain(|r| r.id != id);
        let changed = self.rules.len() != before;
        if changed {
            self.bump_revision();
        }
        changed
    }

    /// Enable a rule by ID. Returns `true` if found and changed.
    pub fn enable_rule(&mut self, id: &str) -> bool {
        self.set_enabled(id, true)
    }

    /// Disable a rule by ID. Returns `true` if found and changed.
    pub fn disable_rule(&mut self, id: &str) -> bool {
        self.set_enabled(id, false)
    }

    fn set_enabled(&mut self, id: &str, enabled: bool) -> bool {
        if let Some(rule) = self.rules.iter_mut().find(|r| r.id == id) {
            if rule.enabled != enabled {
                rule.enabled = enabled;
                self.bump_revision();
                return true;
            }
        }
        false
    }

    // ── Query ──────────────────────────────────────────────────────

    /// List all rules in priority order.
    pub fn list_rules(&self) -> Vec<&Rule> {
        self.rules.iter().collect()
    }

    /// Get a rule by ID.
    pub fn get_rule(&self, id: &str) -> Option<&Rule> {
        self.rules.iter().find(|r| r.id == id)
    }

    /// Snapshot all rules for admin listing.
    pub fn snapshot(&self) -> Vec<RuleSnapshotEntry> {
        self.rules
            .iter()
            .map(|r| RuleSnapshotEntry {
                id: r.id.clone(),
                priority: r.priority,
                enabled: r.enabled,
                action_summary: format_action(&r.action),
                revision: r.revision,
            })
            .collect()
    }

    /// Current revision counter.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Number of rules in the table.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Whether the table has no rules.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    // ── Evaluation ─────────────────────────────────────────────────

    /// Evaluate rules against a context. Returns the action of the first
    /// matching enabled rule, or `None` if no rule matches.
    pub fn evaluate(&self, ctx: &RuleContext) -> Option<RuleAction> {
        self.rules
            .iter()
            .filter(|r| r.enabled)
            .find(|r| matches_rule(&r.matcher, ctx))
            .map(|r| r.action.clone())
    }

    /// Find the first matching enabled rule and return its ID and action.
    /// Returns `None` if no rule matches.
    pub fn find_matching(&self, ctx: &RuleContext) -> Option<(&str, &RuleAction)> {
        self.rules
            .iter()
            .filter(|r| r.enabled)
            .find(|r| matches_rule(&r.matcher, ctx))
            .map(|r| (r.id.as_str(), &r.action))
    }

    fn bump_revision(&mut self) {
        self.revision = self.revision.wrapping_add(1);
    }
}

// ── Matching logic ──────────────────────────────────────────────────

fn matches_rule(matcher: &RuleMatcher, ctx: &RuleContext) -> bool {
    if let Some(ref src) = matcher.source_address {
        if !address_matches(src, ctx.source) {
            return false;
        }
    }
    if let Some(ref tgt) = matcher.target_address {
        if !address_matches(tgt, ctx.target) {
            return false;
        }
    }
    if let Some(ref lt) = matcher.link_type {
        if lt != ctx.link_type {
            return false;
        }
    }
    if let Some(ref sub) = matcher.subtype {
        if sub != ctx.subtype {
            return false;
        }
    }
    if let Some(ref kind) = matcher.kind {
        if kind != ctx.kind {
            return false;
        }
    }
    if let Some(ref neighbor) = matcher.from_neighbor {
        match ctx.from_neighbor {
            Some(from) if from == neighbor => {}
            _ => return false,
        }
    }
    if let Some(min) = matcher.ttl_min {
        if ctx.ttl < min {
            return false;
        }
    }
    if let Some(max) = matcher.ttl_max {
        if ctx.ttl > max {
            return false;
        }
    }
    true
}

/// Check if `pattern` matches `target`. None fields in pattern are wildcards.
fn address_matches(pattern: &SessionAddress, target: &SessionAddress) -> bool {
    if pattern.domain != target.domain {
        return false;
    }
    match &pattern.runtime {
        Some(pr) => match &target.runtime {
            Some(tr) if pr == tr => {}
            _ => return false,
        },
        None => {} // wildcard
    }
    match &pattern.session {
        Some(ps) => match &target.session {
            Some(ts) if ps == ts => {}
            _ => return false,
        },
        None => {} // wildcard
    }
    true
}

// ── Helpers ─────────────────────────────────────────────────────────

fn format_action(action: &RuleAction) -> String {
    match action {
        RuleAction::Drop { reason } => format!("drop: {reason}"),
        RuleAction::ForceNeighbor { neighbor_id } => format!("force→{neighbor_id}"),
        RuleAction::DenyNeighbor { neighbor_id } => format!("deny→{neighbor_id}"),
        RuleAction::Continue => "continue".into(),
    }
}
