//! Tap / observation events.
//!
//! `TapEvent` is the structured event type emitted by the forward engine at
//! each stage of envelope processing. Observers subscribe via
//! [`ForwardEngine::tap_subscribe`](crate::ForwardEngine::tap_subscribe) and
//! receive a stream of these events.
//!
//! This replaces the ad-hoc `GlassVeinObservation` type for internal routing
//! diagnostics. The observe/MITM proxy in `glassvein-router` remains for
//! wire-level frame inspection.

use std::fmt;

use serde::Serialize;

use glassvein_protocol::RouteAddress;

use crate::filter::FilterContext;
use crate::route::NextHop;

// ── TapEvent ────────────────────────────────────────────────────────

/// A structured tap event emitted by the forward engine.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TapEvent {
    /// An envelope arrived at the router.
    #[serde(rename_all = "camelCase")]
    EnvelopeReceived {
        router_id: String,
        message_id: String,
        source: RouteAddress,
        target: RouteAddress,
        kind: String,
        ttl: u8,
        from_hop: Option<NextHopDef>,
    },

    /// A filter was applied to an envelope.
    #[serde(rename_all = "camelCase")]
    FilterApplied {
        router_id: String,
        message_id: String,
        filter_name: String,
        decision: String,
    },

    /// A forwarding decision was made.
    #[serde(rename_all = "camelCase")]
    ForwardDecided {
        router_id: String,
        message_id: String,
        plan: ForwardPlanDef,
        distance: Option<u16>,
    },

    /// An envelope was successfully forwarded out.
    #[serde(rename_all = "camelCase")]
    EnvelopeForwarded {
        router_id: String,
        message_id: String,
        target_id: String,
        target_address: RouteAddress,
    },

    /// An envelope was dropped.
    #[serde(rename_all = "camelCase")]
    EnvelopeDropped {
        router_id: String,
        message_id: String,
        reason: String,
    },

    /// Route table changed.
    #[serde(rename_all = "camelCase")]
    RouteTableChanged {
        router_id: String,
        total_entries: usize,
    },

    /// A peer connected or disconnected.
    #[serde(rename_all = "camelCase")]
    PeerEvent {
        router_id: String,
        peer_id: String,
        connected: bool,
    },
}

// ── Serializable helpers ────────────────────────────────────────────

/// Serializable representation of [`NextHop`].
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextHopDef {
    Peer(String),
    Upstream(String),
}

impl From<&NextHop> for NextHopDef {
    fn from(hop: &NextHop) -> Self {
        match hop {
            NextHop::Peer(id) => NextHopDef::Peer(id.clone()),
            NextHop::Upstream(id) => NextHopDef::Upstream(id.clone()),
        }
    }
}

/// Serializable representation of [`ForwardPlan`](crate::ForwardPlan).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "plan", rename_all = "snake_case")]
pub enum ForwardPlanDef {
    #[serde(rename_all = "camelCase")]
    DeliverLocal { peer_id: String },

    #[serde(rename_all = "camelCase")]
    ForwardPeer { peer_id: String },

    #[serde(rename_all = "camelCase")]
    ForwardUpstream { upstream_id: String },

    #[serde(rename_all = "camelCase")]
    Drop { reason: String },

    #[serde(rename_all = "camelCase")]
    NoRoute { fallback_available: bool },
}

impl fmt::Display for TapEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TapEvent::EnvelopeReceived {
                router_id,
                message_id,
                ..
            } => {
                write!(f, "[{router_id}] received envelope {message_id}")
            }
            TapEvent::FilterApplied {
                router_id,
                message_id,
                filter_name,
                decision,
                ..
            } => {
                write!(
                    f,
                    "[{router_id}] filter {filter_name} on {message_id}: {decision}"
                )
            }
            TapEvent::ForwardDecided {
                router_id,
                message_id,
                plan,
                ..
            } => {
                write!(f, "[{router_id}] decided for {message_id}: {plan:?}")
            }
            TapEvent::EnvelopeForwarded {
                router_id,
                message_id,
                target_id,
                ..
            } => {
                write!(f, "[{router_id}] forwarded {message_id} to {target_id}")
            }
            TapEvent::EnvelopeDropped {
                router_id,
                message_id,
                reason,
                ..
            } => {
                write!(f, "[{router_id}] dropped {message_id}: {reason}")
            }
            TapEvent::RouteTableChanged {
                router_id,
                total_entries,
            } => {
                write!(
                    f,
                    "[{router_id}] route table changed, {total_entries} entries"
                )
            }
            TapEvent::PeerEvent {
                router_id,
                peer_id,
                connected,
            } => {
                let action = if *connected {
                    "connected"
                } else {
                    "disconnected"
                };
                write!(f, "[{router_id}] peer {peer_id} {action}")
            }
        }
    }
}
