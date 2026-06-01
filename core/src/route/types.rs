//! Route types: next-hop, decision, announcement, and internal entry/bucket.

use osgp::SessionAddress;

// ── RouteOrigin ────────────────────────────────────────────────────

/// Whether a route was learned from a peer announcement or manually
/// inserted by an admin endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouteOrigin {
    /// Learned from neighbor Hello or Announce messages.
    Learned,
    /// Manually inserted via admin plane.
    Manual,
}

// ── NextHop ─────────────────────────────────────────────────────────

/// Identifies where a route points: a local delivery, a neighbor, or a drop.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum NextHop {
    /// Deliver to a local endpoint (e.g., directly attached client/surface).
    Local,
    /// Forward to a neighbor (upstream router or downstream peer).
    Neighbor(String),
    /// Drop the envelope with a reason.
    Drop(String),
}

// ── ForwardDecision ─────────────────────────────────────────────────

/// Routing decision for one envelope. Produced by [`RouteTable::decide`]
/// and consumed by the forward engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardDecision {
    pub next_hop: NextHop,
}

// ── RouteEntry (internal) ───────────────────────────────────────────

#[derive(Debug, Clone)]
pub(super) struct RouteEntry {
    pub(super) neighbor: String,
    pub(super) distance: u32,
    pub(super) origin: RouteOrigin,
}

// ── RouteAnnouncement ───────────────────────────────────────────────

/// A route announcement received from a neighbor.
#[derive(Debug, Clone)]
pub struct RouteAnnouncement {
    pub address: SessionAddress,
    pub distance: u32,
}

impl RouteAnnouncement {
    /// Create an announcement for a locally-attached address (distance 0).
    pub fn local(address: SessionAddress) -> Self {
        Self {
            address,
            distance: 0,
        }
    }
}

// ── RouteSnapshotEntry ──────────────────────────────────────────────

/// A public snapshot entry for route table inspection / admin list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteSnapshotEntry {
    pub address: SessionAddress,
    pub neighbor: String,
    pub distance: u32,
    pub origin: RouteOrigin,
}

// ── RouteBucket (internal) ──────────────────────────────────────────

#[derive(Debug, Clone)]
pub(super) struct RouteBucket {
    pub(super) address: SessionAddress,
    pub(super) entries: Vec<RouteEntry>,
}
