//! Read request/response forwarding logic.
//!
//! Router forwards read requests by `request.target` and read responses by
//! `response.target` (the original request source). It does not understand
//! business semantics of any operation subtype.
//!
//! ## Addressing model
//!
//! - `ReadRequest.source` = reply-to endpoint address (where to send the response).
//! - `ReadRequest.target` = the queried runtime/session address.
//! - `ReadResponse.source` = the responding runtime/endpoint.
//! - `ReadResponse.target` = reply-to address (= original request's `source`).
//!
//! Router routes purely by address. No `surface_id` or request→source mapping needed.
use std::sync::Arc;

use anyhow::Result;
use osgp::{LinkMessage, ReadOperation, ReadRequest, ReadResponse, SessionAddress, SessionEnvelope};
use tracing::{debug, info, warn};

use crate::connection::ConnectionManager;
use crate::format_address;
use crate::tap::TapEvent;

/// Check if an endpoint is authorized to perform the requested operation.
///
/// Router does not enforce user-layer read permissions. Authorization belongs
/// to endpoint services; router only forwards by target/address.
pub async fn check_read_permission(
    connections: &ConnectionManager,
    source: &SessionAddress,
    operation: &ReadOperation,
) -> Result<(), String> {
    let _ = (connections, source, operation);
    Ok(())
}

/// Route a read response back toward the requesting endpoint.
///
/// Routes by `response.target` (the original request's source address).
/// Resolves via:
/// 1. Direct peer by node_id (exact match on target.domain).
/// 2. Route table address lookup (for upstream/indirect endpoints).
pub async fn route_read_response_back(
    node_id: &str,
    connections: &ConnectionManager,
    route_table: &gv_core::RouteTable,
    from_neighbor: Option<&str>,
    response: &ReadResponse,
    emit_tap: &Arc<dyn Fn(TapEvent) + Send + Sync>,
) {
    let target_str = format_address(&response.target);

    emit_tap(TapEvent::ReadResponseForward {
        request_id: response.request_id.clone(),
        target: target_str.clone(),
        status: format!("{:?}", response.status),
        is_ok: response.is_ok(),
    });

    // Try direct peer delivery first (endpoint connected to this router)
    {
        let peers = connections.peers.read().await;
        if let Some(handle) = peers.get(&response.target.domain) {
            if handle
                .send(LinkMessage::ReadResponse(response.clone()))
                .is_ok()
            {
                debug!(
                    router = %node_id,
                    target = %target_str,
                    request_id = %response.request_id,
                    "read response delivered directly to endpoint"
                );
                return;
            }
        }

        let peer_routes = connections.peer_routes.read().await;
        if let Some((peer_id, _)) = peer_routes
            .iter()
            .find(|(_, addresses)| addresses.iter().any(|addr| addr == &response.target))
        {
            if let Some(handle) = peers.get(peer_id) {
                if handle
                    .send(LinkMessage::ReadResponse(response.clone()))
                    .is_ok()
                {
                    debug!(
                        router = %node_id,
                        target = %target_str,
                        peer = %peer_id,
                        "read response delivered directly by announced address"
                    );
                    return;
                }
            }
        }
    }

    // Not directly connected — route via address lookup
    let temp_envelope = SessionEnvelope::new(
        SessionAddress::new(node_id, None, None),
        response.target.clone(),
        "read_response",
        serde_json::Value::Null,
    );

    let decision = route_table.decide(&temp_envelope);

    match &decision.next_hop {
        gv_core::NextHop::Neighbor(neighbor_id) => {
            let peers = connections.peers.read().await;
            if let Some(handle) = peers.get(neighbor_id) {
                if handle.send(LinkMessage::ReadResponse(response.clone())).is_ok() {
                    debug!(
                        router = %node_id,
                        target = %target_str,
                        neighbor = %neighbor_id,
                        "read response routed via neighbor"
                    );
                    return;
                }
            }
            warn!(
                router = %node_id,
                target = %target_str,
                "read response could not be routed back (neighbor send failed)"
            );
        }
        _ => {
            let upstream = connections.upstream.read().await;
            if let Some(upstream) = upstream.as_ref() {
                if from_neighbor != Some(upstream.node_id.as_str())
                    && upstream.send(LinkMessage::ReadResponse(response.clone())).is_ok()
                {
                    debug!(
                        router = %node_id,
                        target = %target_str,
                        upstream = %upstream.node_id,
                        "read response routed via upstream fallback"
                    );
                    return;
                }
            }
            warn!(
                router = %node_id,
                target = %target_str,
                "read response could not be routed back (no route to endpoint)"
            );
        }
    }
}

/// Forward a cross-domain read request.
///
/// Routes by `request.target` via the route table. If unroutable, sends an
/// error response back toward `request.source` (the reply-to address).
pub async fn forward_read_request(
    node_id: &str,
    connections: &ConnectionManager,
    route_table: &gv_core::RouteTable,
    _from_neighbor: &str,
    request: ReadRequest,
    emit_tap: &Arc<dyn Fn(TapEvent) + Send + Sync>,
) {
    let source_str = format_address(&request.source);

    // Step 1: TTL check
    if request.ttl == 0 {
        emit_tap(TapEvent::ReadRequestDrop {
            request_id: request.request_id.clone(),
            source: source_str,
            op: request.operation.op_name().to_string(),
            reason: "ttl_exhausted".to_string(),
        });
        let error_response = ReadResponse::error_for_request(
            &SessionAddress::new(node_id, None, None),
            &request,
            "ttl_exhausted",
        );
        route_read_response_back(
            node_id,
            connections,
            route_table,
            None,
            &error_response,
            &*emit_tap,
        )
        .await;
        return;
    }

    let mut request = request;
    request.ttl -= 1;
    request.route_hops.push(node_id.to_string());

    // Route resolution by target
    let temp_envelope = SessionEnvelope::new(
        SessionAddress::new(node_id, None, None),
        request.target.clone(),
        "read_request",
        serde_json::Value::Null,
    );

    let decision = route_table.decide(&temp_envelope);

    emit_tap(TapEvent::ReadRequestForward {
        request_id: request.request_id.clone(),
        source: source_str.clone(),
        op: request.operation.op_name().to_string(),
        target: format_address(&request.target),
    });

    // Forward or drop
    match &decision.next_hop {
        gv_core::NextHop::Local => {
            info!(
                router = %node_id,
                request_id = %request.request_id,
                op = %request.operation.op_name(),
                source = %source_str,
                "read request resolved to local"
            );
            // Router only forwards; it does not implement business state.
            let local_response = ReadResponse::ok_for_request(
                &SessionAddress::new(node_id, None, None),
                &request,
                serde_json::json!({"status": "not_implemented", "reason": "router does not handle business state; plugin/client should respond"}),
            );
            route_read_response_back(
                node_id,
                connections,
                route_table,
                None,
                &local_response,
                &*emit_tap,
            )
            .await;
        }
        gv_core::NextHop::Neighbor(neighbor_id) => {
            let peers = connections.peers.read().await;
            if let Some(handle) = peers.get(neighbor_id) {
                if handle.send(LinkMessage::ReadRequest(request)).is_ok() {
                    debug!(
                        router = %node_id,
                        neighbor = %neighbor_id,
                        "read request forwarded to neighbor"
                    );
                    return;
                }
            }
            warn!(
                router = %node_id,
                neighbor = %neighbor_id,
                "read request forward failed (peer not found or channel closed)"
            );
        }
        gv_core::NextHop::Drop(reason) => {
            // No local route — try upstream fallback before dropping.
            let upstream_ref = connections.upstream.read().await;
            let should_try_upstream = upstream_ref.as_ref().map_or(false, |up| {
                up.node_id != _from_neighbor
            });

            if should_try_upstream {
                // Clone for upstream attempt; keep original for error response fallback.
                let upstream = upstream_ref.as_ref().unwrap();
                if upstream
                    .send(LinkMessage::ReadRequest(request.clone()))
                    .is_ok()
                {
                    debug!(
                        router = %node_id,
                        upstream = %upstream.node_id,
                        "read request forwarded to upstream as fallback"
                    );
                    return;
                }
                warn!(
                    router = %node_id,
                    "read request upstream fallback send failed"
                );
            }
            drop(upstream_ref);

            // No upstream available or send failed — send error response back to source.
            emit_tap(TapEvent::ReadRequestDrop {
                request_id: request.request_id.clone(),
                source: source_str,
                op: request.operation.op_name().to_string(),
                reason: reason.clone(),
            });
            let error_response = ReadResponse::error_for_request(
                &SessionAddress::new(node_id, None, None),
                &request,
                reason,
            );
            route_read_response_back(
                node_id,
                connections,
                route_table,
                None,
                &error_response,
                &*emit_tap,
            )
            .await;
        }
    }
}

/// Forward a read response back toward the requesting endpoint.
///
/// Routes by `response.target` via the route table. The target is the
/// original request's `source` address, set by the responding endpoint.
pub async fn forward_read_response(
    node_id: &str,
    connections: &ConnectionManager,
    route_table: &gv_core::RouteTable,
    from_neighbor: &str,
    response: ReadResponse,
    emit_tap: &Arc<dyn Fn(TapEvent) + Send + Sync>,
) {
    route_read_response_back(
        node_id,
        connections,
        route_table,
        Some(from_neighbor),
        &response,
        &*emit_tap,
    )
    .await;
}
