//! Typed envelope forwarding.

use tracing::{debug, info, warn};

use crate::node::RouterNode;
use crate::tap::TapEvent;

/// Forward a typed envelope. Router does not interpret user-layer business
/// types; upload fan-out/aggregation must target explicit service endpoints.
///
/// - Upload: fan out to surface_viewer endpoints.
/// - Other (Control/Request/Response): route by target address via route table,
///   with upstream fallback if no local route.
pub async fn forward_typed_envelope(
    node: &RouterNode,
    _from_neighbor: &str,
    envelope: osgp::Envelope,
) {
    debug!(
        router = %node.node_id(),
        message_id = %envelope.message_id,
        link_type = ?envelope.link_type,
        subtype = %envelope.subtype,
        "forwarding typed envelope"
    );

    if envelope.link_type == osgp::LinkType::Upload {
        fanout_typed_upload_to_surface_viewers(node, &envelope).await;
        node.emit_tap(TapEvent::ControlForward {
            message_id: envelope.message_id.clone(),
            kind: format!("{:?}:{}", envelope.link_type, envelope.subtype),
        });
        return;
    }

    // Non-upload: route by target address
    let target = match &envelope.target {
        osgp::RouteTarget::Address { address } => address.clone(),
        osgp::RouteTarget::Node { node } => {
            osgp::SessionAddress::new(&node.0, None, None)
        }
        osgp::RouteTarget::Session { node, session } => {
            osgp::SessionAddress::new(&node.0, None, Some(session.0.clone()))
        }
    };

    let temp_envelope = osgp::SessionEnvelope::new(
        osgp::SessionAddress::new(node.node_id(), None, None),
        target.clone(),
        &format!("{:?}:{}", envelope.link_type, envelope.subtype),
        serde_json::Value::Null,
    );

    let decision = node.route_table.read().await.decide(&temp_envelope);

    // Save tap data before envelope is potentially moved
    let tap_message_id = envelope.message_id.clone();
    let tap_kind = format!("{:?}:{}", envelope.link_type, envelope.subtype);

    match &decision.next_hop {
        gv_core::NextHop::Neighbor(neighbor_id) => {
            let peers = node.connections.peers.read().await;
            if let Some(handle) = peers.get(neighbor_id) {
                if handle.send(osgp::LinkMessage::TypedEnvelope(envelope)).is_ok() {
                    debug!(
                        router = %node.node_id(),
                        neighbor = %neighbor_id,
                        "typed envelope routed to neighbor"
                    );
                }
            }
        }
        gv_core::NextHop::Local => {
            info!(
                router = %node.node_id(),
                message_id = %envelope.message_id,
                "typed envelope resolved to local"
            );
        }
        gv_core::NextHop::Drop(_) => {
            // No local route — try upstream fallback (but don't reflect
            // back to the upstream that sent it to us).
            let upstream = node.connections.upstream.read().await;
            if let Some(upstream) = upstream.as_ref() {
                if upstream.node_id != _from_neighbor {
                    if upstream.send(osgp::LinkMessage::TypedEnvelope(envelope)).is_ok() {
                        debug!(
                            router = %node.node_id(),
                            upstream = %upstream.node_id,
                            "typed envelope forwarded to upstream as fallback"
                        );
                    } else {
                        warn!(
                            router = %node.node_id(),
                            "typed envelope upstream fallback failed"
                        );
                    }
                }
            }
        }
    }

    node.emit_tap(TapEvent::ControlForward {
        message_id: tap_message_id,
        kind: tap_kind,
    });
}

async fn fanout_typed_upload_to_surface_viewers(
    node: &RouterNode,
    envelope: &osgp::Envelope,
) {
    let peers = node.connections.peers.read().await;
    for handle in peers.values() {
        if !handle.role.is_router() && handle.has_capability("surface_viewer") {
            let _ = handle.send(osgp::LinkMessage::TypedEnvelope(envelope.clone()));
        }
    }
}
