//! Drop handling and error reply generation.

use serde_json::json;
use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
use tracing::{debug, warn};

use crate::format_address;
use crate::node::RouterNode;
use crate::tap::{EnvelopeSummary, TapEvent};

/// Send a message to a specific downstream peer.
pub(crate) async fn send_to_peer(node: &RouterNode, peer_id: &str, message: LinkMessage) {
    let peers = node.connections.peers.read().await;
    if let Some(handle) = peers.get(peer_id) {
        if handle.send(message).is_ok() {
            return;
        }
    }
    warn!(router = %node.node_id(), peer = %peer_id, "send failed: peer not found or channel closed");
}

/// Handle an envelope that could not be routed.
pub(crate) async fn handle_drop(node: &RouterNode, envelope: SessionEnvelope, reason: &str) {
    node.emit_tap(TapEvent::DropNoRoute {
        summary: EnvelopeSummary::from_envelope(&envelope),
        reason: reason.to_string(),
    });

    warn!(
        router = %node.node_id(),
        envelope_id = %envelope.id,
        target = %format_address(&envelope.target),
        reason,
        "drop: no route"
    );

    // Build error reply
    let error_reply = SessionEnvelope::new(
        SessionAddress::new(node.node_id(), None, None),
        envelope.source.clone(),
        "error.no_route",
        json!({
            "error": "no_route",
            "originalTarget": {
                "domain": envelope.target.domain,
                "runtime": envelope.target.runtime,
                "session": envelope.target.session,
            },
            "originalMessageId": envelope.id.to_string(),
            "originalKind": envelope.kind,
            "reason": reason,
        }),
    );

    node.emit_tap(TapEvent::ErrorReply {
        summary: EnvelopeSummary::from_envelope(&envelope),
        error_kind: "error.no_route".to_string(),
    });

    // Single-hop attempt to deliver error reply
    let decision = node.route_table.read().await.decide(&error_reply);
    match &decision.next_hop {
        gv_core::NextHop::Neighbor(neighbor_id) => {
            send_to_peer(node, neighbor_id, LinkMessage::Envelope(error_reply)).await;
        }
        _ => {
            debug!(router = %node.node_id(), "error reply could not be delivered");
        }
    }
}
