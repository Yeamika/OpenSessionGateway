//! Legacy envelope forwarding.

use tracing::{debug, info, warn};

use crate::node::RouterNode;
use crate::tap::{EnvelopeSummary, TapEvent};

/// Forward a SessionEnvelope based on routing decision.
///
/// Router only forwards by target/address. Upload fan-out/aggregation belongs
/// to explicit user-layer service endpoints, not router peer roles.
///
/// For non-upload envelopes with no local route, falls back to upstream if
/// one is connected. This ensures cross-router control/response delivery in
/// tree topologies.
pub async fn forward_envelope(
    node: &RouterNode,
    _from_neighbor: &str,
    mut envelope: osgp::SessionEnvelope,
) {
    if envelope.ttl == 0 {
        node.emit_tap(TapEvent::DropTtl {
            summary: EnvelopeSummary::from_envelope(&envelope),
        });
        warn!(router = %node.node_id(), envelope_id = %envelope.id, "drop: TTL exhausted");
        return;
    }
    envelope.ttl -= 1;
    envelope.route_hops.push(node.node_id().to_string());

    if envelope.link_type == "upload" {
        fanout_upload_to_surface_viewers(node, &envelope).await;
        return;
    }

    let decision = node.route_table.read().await.decide(&envelope);

    match &decision.next_hop {
        gv_core::NextHop::Local => {
            info!(router = %node.node_id(), envelope_id = %envelope.id, "envelope resolved to local");
        }
        gv_core::NextHop::Neighbor(neighbor_id) => {
            super::drop::send_to_peer(
                node,
                neighbor_id,
                osgp::LinkMessage::Envelope(envelope),
            )
            .await;
        }
        gv_core::NextHop::Drop(reason) => {
            // No local route — try upstream fallback before dropping.
            let upstream = node.connections.upstream.read().await;
            if let Some(upstream) = upstream.as_ref() {
                if upstream.node_id != _from_neighbor {
                    // Clone for upstream attempt; keep original for handle_drop fallback.
                    if upstream
                        .send(osgp::LinkMessage::Envelope(envelope.clone()))
                        .is_ok()
                    {
                        debug!(
                            router = %node.node_id(),
                            upstream = %upstream.node_id,
                            "envelope forwarded to upstream as fallback"
                        );
                        return;
                    }
                    warn!(
                        router = %node.node_id(),
                        "envelope upstream fallback send failed"
                    );
                }
            }
            // Upstream not available or send failed — handle the drop
            super::drop::handle_drop(node, envelope, reason).await;
        }
    }
}

async fn fanout_upload_to_surface_viewers(
    node: &RouterNode,
    envelope: &osgp::SessionEnvelope,
) {
    let peers = node.connections.peers.read().await;
    let mut delivered = 0usize;
    for (peer_id, handle) in peers.iter() {
        if handle.role.is_router() || !handle.has_capability("surface_viewer") {
            continue;
        }
        if handle
            .send(osgp::LinkMessage::Envelope(envelope.clone()))
            .is_ok()
        {
            delivered += 1;
            info!(router = %node.node_id(), peer = %peer_id, envelope_id = %envelope.id, subtype = %envelope.subtype, "upload fanned out to surface_viewer endpoint");
        }
    }
    if delivered == 0 {
        info!(router = %node.node_id(), envelope_id = %envelope.id, subtype = %envelope.subtype, "upload consumed locally; no surface_viewer endpoints connected");
    }
}
