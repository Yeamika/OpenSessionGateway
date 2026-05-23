//! Tap event types for router observation.
//!
//! Surface/Panel roles subscribe to tap events to observe forwarding activity.
//! Regular Client roles do not receive tap events — they only see messages
//! routed directly to them.

use osgp::SessionEnvelope;
use serde::Serialize;

// ── Tap events ──────────────────────────────────────────────────────

/// Observation event emitted when the router processes an envelope.
///
/// Delivered via `broadcast::Sender<TapEvent>` — multiple subscribers
/// supported. Slow receivers will miss events (lagged).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TapEvent {
    // ── Envelope forwarding ─────────────────────────────────────────
    /// Envelope was forwarded to a downstream peer.
    ForwardPeer {
        summary: EnvelopeSummary,
        peer_id: String,
        distance: u32,
    },
    /// Envelope was dropped: TTL exhausted.
    DropTtl { summary: EnvelopeSummary },
    /// Envelope was dropped: no route found.
    DropNoRoute {
        summary: EnvelopeSummary,
        reason: String,
    },
    /// An error reply was sent back to the source.
    ErrorReply {
        summary: EnvelopeSummary,
        error_kind: String,
    },
    /// A control command (typed envelope) was forwarded.
    ControlForward { message_id: String, kind: String },

    // ── Cross-domain read request/response ──────────────────────────
    /// A read request was forwarded to the next hop.
    ReadRequestForward {
        request_id: String,
        /// Reply-to address: the endpoint that sent the request (request.source).
        source: String,
        /// Operation name (e.g., "runtimeSessionMessages").
        op: String,
        target: String,
    },
    /// A read request was dropped (no route, TTL, or permission denied).
    ReadRequestDrop {
        request_id: String,
        /// Reply-to address: the endpoint that sent the request.
        source: String,
        /// Operation name.
        op: String,
        reason: String,
    },
    /// A read response was forwarded back toward the requesting endpoint.
    ReadResponseForward {
        request_id: String,
        /// The endpoint the response is being routed toward (response.target / request.source).
        target: String,
        status: String,
        is_ok: bool,
    },
    /// A read request was denied due to insufficient permissions.
    ReadRequestPermissionDenied {
        request_id: String,
        /// Reply-to address: the endpoint that sent the request.
        source: String,
        op: String,
        reason: String,
    },
}

/// Serializable summary of an envelope (avoids cloning the full payload).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeSummary {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub ttl: u8,
}

impl EnvelopeSummary {
    pub fn from_envelope(env: &SessionEnvelope) -> Self {
        Self {
            id: env.id.to_string(),
            source: format_address(&env.source),
            target: format_address(&env.target),
            kind: env.kind.clone(),
            ttl: env.ttl,
        }
    }
}

fn format_address(addr: &osgp::SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use osgp::SessionAddress;
    use serde_json::json;

    #[test]
    fn envelope_summary_from_envelope() {
        let env = SessionEnvelope::new(
            SessionAddress::new("dom-a", Some("rt-1".into()), Some("s-1".into())),
            SessionAddress::new("dom-b", None, None),
            "test.kind",
            json!({}),
        );
        let summary = EnvelopeSummary::from_envelope(&env);
        assert_eq!(summary.source, "dom-a/rt-1/s-1");
        assert_eq!(summary.target, "dom-b/*/*");
        assert_eq!(summary.kind, "test.kind");
        assert_eq!(summary.ttl, 32);
    }

    #[test]
    fn tap_event_serialization() {
        let event = TapEvent::DropTtl {
            summary: EnvelopeSummary {
                id: "test-id".into(),
                source: "a".into(),
                target: "b".into(),
                kind: "test".into(),
                ttl: 0,
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"drop_ttl\""));
    }
}
