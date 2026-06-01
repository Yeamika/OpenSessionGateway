//! Envelope forwarding tests.
//!
//! Split into sub-modules for maintainability (each ≤ 500 lines).

mod basic;
mod cross_router;
mod cross_router_deep;
mod upstream;

use serde_json::json;
use gv_core::PermissionOp;
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionEnvelope};
use tokio::sync::mpsc;

use crate::config::RouterConfig;
use crate::node::RouterNode;
use crate::tap::TapEvent;
use crate::transport::{PeerHandle, PeerRole, UpstreamHandle};

fn make_config(node_id: &str) -> RouterConfig {
    RouterConfig::new(node_id, "127.0.0.1:0").with_tap(64)
}

fn make_peer(
    node_id: &str,
    role: PeerRole,
) -> (
    PeerHandle,
    mpsc::UnboundedReceiver<osgp::LinkMessage>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = PeerHandle::new(node_id, role, tx);
    (handle, rx)
}

fn make_upstream(
    node_id: &str,
) -> (
    UpstreamHandle,
    mpsc::UnboundedReceiver<osgp::LinkMessage>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = UpstreamHandle::new(node_id, tx);
    (handle, rx)
}

fn make_envelope(source: &str, target: &str, kind: &str) -> SessionEnvelope {
    SessionEnvelope::new(
        SessionAddress::new(source, None, None),
        SessionAddress::new(target, None, None),
        kind,
        json!({}),
    )
}

/// Grant a permission to a peer for testing.
async fn grant(node: &RouterNode, peer_id: &str, op: PermissionOp) {
    let mut perms = node.permission_queue.write().await;
    let id = perms.enqueue(peer_id.to_string(), op);
    perms.approve(&id, gv_core::ApprovalKind::Persist);
}

/// Grant announce + read permissions to a peer for testing.
async fn grant_standard(node: &RouterNode, peer_id: &str) {
    grant(node, peer_id, PermissionOp::AnnounceRoute).await;
    grant(node, peer_id, PermissionOp::ReadRuntimeSessionMessages).await;
}
