//! Tap / observation events emitted by the forward engine.
//!
//! `TapEvent` is the structured event type emitted at each stage of envelope
//! processing. Observers subscribe via the forward engine's tap channel and
//! receive a stream of these events.

use std::fmt;

use serde::Serialize;
use osgp::SessionAddress;

// ── TapEvent ────────────────────────────────────────────────────────

/// A structured tap event emitted by the forward engine.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TapEvent {
    /// An envelope arrived at the router.
    #[serde(rename_all = "camelCase")]
    EnvelopeReceived {
        router_id: String,
        envelope_id: String,
        source: SessionAddress,
        target: SessionAddress,
        kind: String,
        ttl: u8,
    },

    /// A filter was applied to an envelope.
    #[serde(rename_all = "camelCase")]
    FilterApplied {
        router_id: String,
        envelope_id: String,
        filter_name: String,
        decision: String,
    },

    /// A forwarding decision was made.
    #[serde(rename_all = "camelCase")]
    ForwardDecided {
        router_id: String,
        envelope_id: String,
        neighbor: Option<String>,
        dropped: bool,
        reason: Option<String>,
    },

    /// An envelope was successfully forwarded out.
    #[serde(rename_all = "camelCase")]
    EnvelopeForwarded {
        router_id: String,
        envelope_id: String,
        target_neighbor: String,
        target_address: SessionAddress,
    },

    /// An envelope was dropped.
    #[serde(rename_all = "camelCase")]
    EnvelopeDropped {
        router_id: String,
        envelope_id: String,
        reason: String,
    },

    /// Route table changed.
    #[serde(rename_all = "camelCase")]
    RouteTableChanged {
        router_id: String,
        total_entries: usize,
    },

    /// A neighbor connected or disconnected.
    #[serde(rename_all = "camelCase")]
    NeighborEvent {
        router_id: String,
        neighbor_id: String,
        connected: bool,
    },
}

impl fmt::Display for TapEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TapEvent::EnvelopeReceived {
                router_id,
                envelope_id,
                ..
            } => {
                write!(f, "[{router_id}] received envelope {envelope_id}")
            }
            TapEvent::FilterApplied {
                router_id,
                envelope_id,
                filter_name,
                decision,
                ..
            } => {
                write!(
                    f,
                    "[{router_id}] filter {filter_name} on {envelope_id}: {decision}"
                )
            }
            TapEvent::ForwardDecided {
                router_id,
                envelope_id,
                neighbor,
                dropped,
                ..
            } => {
                let target = neighbor.as_deref().unwrap_or("none");
                let action = if *dropped { "drop" } else { "forward" };
                write!(
                    f,
                    "[{router_id}] decided {action} for {envelope_id} → {target}"
                )
            }
            TapEvent::EnvelopeForwarded {
                router_id,
                envelope_id,
                target_neighbor,
                ..
            } => {
                write!(
                    f,
                    "[{router_id}] forwarded {envelope_id} to {target_neighbor}"
                )
            }
            TapEvent::EnvelopeDropped {
                router_id,
                envelope_id,
                reason,
                ..
            } => {
                write!(f, "[{router_id}] dropped {envelope_id}: {reason}")
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
            TapEvent::NeighborEvent {
                router_id,
                neighbor_id,
                connected,
            } => {
                let action = if *connected {
                    "connected"
                } else {
                    "disconnected"
                };
                write!(f, "[{router_id}] neighbor {neighbor_id} {action}")
            }
        }
    }
}
