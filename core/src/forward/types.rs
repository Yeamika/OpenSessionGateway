//! Forward engine types: plan, decision, metrics.

use std::sync::atomic::{AtomicU64, Ordering};

// ── ForwardPlan ─────────────────────────────────────────────────────

/// What the forward engine plans to do with an envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForwardPlan {
    /// Deliver to an attached endpoint.
    DeliverLocal,
    /// Forward to a specific neighbor.
    ForwardNeighbor { neighbor_id: String },
    /// Drop the envelope with a reason.
    Drop { reason: String },
    /// No route found; fallback may be available.
    NoRoute { fallback_available: bool },
}

impl ForwardPlan {
    /// Get the target neighbor ID, if any.
    pub fn target_id(&self) -> Option<&str> {
        match self {
            Self::ForwardNeighbor { neighbor_id } => Some(neighbor_id),
            _ => None,
        }
    }
}

// ── RouteDecision ───────────────────────────────────────────────────

/// The complete routing decision for an envelope, including filter results.
#[derive(Clone, Debug)]
pub struct RouteDecision {
    /// The forward plan decided by the engine.
    pub plan: ForwardPlan,
    /// Name of the filter that caused a drop (if any).
    pub blocked_by_filter: Option<String>,
    /// Route hops accumulated so far.
    pub hops: Vec<String>,
    /// ID of the rule that matched (if any). For diagnostics/audit.
    pub matched_rule_id: Option<String>,
}

// ── ForwardMetrics (internal) ───────────────────────────────────────

#[derive(Default)]
pub(super) struct ForwardMetrics {
    pub(super) forwarded_total: AtomicU64,
    pub(super) dropped_total: AtomicU64,
    pub(super) filtered_total: AtomicU64,
    pub(super) rule_dropped_total: AtomicU64,
}

impl ForwardMetrics {
    pub(super) fn record_forward(&self) {
        self.forwarded_total.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) fn record_drop(&self) {
        self.dropped_total.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) fn record_filtered(&self) {
        self.filtered_total.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) fn record_rule_drop(&self) {
        self.rule_dropped_total.fetch_add(1, Ordering::Relaxed);
    }
}

/// A point-in-time snapshot of forwarding metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForwardMetricsSnapshot {
    pub forwarded_total: u64,
    pub dropped_total: u64,
    pub filtered_total: u64,
    pub rule_dropped_total: u64,
}

// ── Helper trait ────────────────────────────────────────────────────

pub(super) trait NoRouteExt {
    fn or_else_drop(self, reason: &str) -> ForwardPlan;
}

impl NoRouteExt for ForwardPlan {
    fn or_else_drop(self, reason: &str) -> ForwardPlan {
        match self {
            ForwardPlan::NoRoute { fallback_available } => {
                if !fallback_available {
                    ForwardPlan::Drop {
                        reason: reason.to_string(),
                    }
                } else {
                    self
                }
            }
            other => other,
        }
    }
}
