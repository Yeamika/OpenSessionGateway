//! Rule types: matcher, action, and rule definition.

use osgp::SessionAddress;

// ── RuleAction ──────────────────────────────────────────────────────

/// Action to take when a rule matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleAction {
    /// Drop the envelope with a reason.
    Drop { reason: String },
    /// Force forwarding to a specific neighbor (override route table).
    ForceNeighbor { neighbor_id: String },
    /// Deny forwarding to a specific neighbor (remove from candidates).
    DenyNeighbor { neighbor_id: String },
    /// No-op; continue to next rule or route resolution.
    Continue,
}

// ── RuleMatcher ─────────────────────────────────────────────────────

/// Match criteria for a rule. All non-None fields must match (AND logic).
/// A None field means "match any".
#[derive(Debug, Clone, Default)]
pub struct RuleMatcher {
    /// Match source address (exact or prefix).
    pub source_address: Option<SessionAddress>,
    /// Match target address (exact or prefix).
    pub target_address: Option<SessionAddress>,
    /// Match link type string: "upload", "control", "request", "response".
    pub link_type: Option<String>,
    /// Match subtype string.
    pub subtype: Option<String>,
    /// Match legacy kind string.
    pub kind: Option<String>,
    /// Match the neighbor the envelope arrived from.
    pub from_neighbor: Option<String>,
    /// Minimum TTL (inclusive). None = no lower bound.
    pub ttl_min: Option<u8>,
    /// Maximum TTL (inclusive). None = no upper bound.
    pub ttl_max: Option<u8>,
}

// ── Rule ────────────────────────────────────────────────────────────

/// A forwarding rule evaluated before route resolution.
#[derive(Debug, Clone)]
pub struct Rule {
    /// Unique rule identifier.
    pub id: String,
    /// Priority — lower values are evaluated first.
    pub priority: u32,
    /// Whether this rule is active.
    pub enabled: bool,
    /// Match criteria.
    pub matcher: RuleMatcher,
    /// Action to take on match.
    pub action: RuleAction,
    /// Revision counter (reserved for optimistic concurrency).
    pub revision: u64,
}

// ── RuleContext ──────────────────────────────────────────────────────

/// Context provided for rule evaluation. Built from an envelope +
/// from_neighbor by the router layer.
#[derive(Debug, Clone)]
pub struct RuleContext<'a> {
    pub source: &'a SessionAddress,
    pub target: &'a SessionAddress,
    pub link_type: &'a str,
    pub subtype: &'a str,
    pub kind: &'a str,
    pub from_neighbor: Option<&'a str>,
    pub ttl: u8,
}

// ── RuleSnapshotEntry ───────────────────────────────────────────────

/// Public snapshot of a rule for admin listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleSnapshotEntry {
    pub id: String,
    pub priority: u32,
    pub enabled: bool,
    pub action_summary: String,
    pub revision: u64,
}
