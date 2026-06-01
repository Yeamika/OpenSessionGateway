//! Operator shell parser and executor tests.
//!
//! Split into sub-modules for maintainability (each ≤ 500 lines).

mod executor;
mod integration;
mod parser;

use super::*;
use std::sync::Arc;
use tokio::sync::RwLock;

use gv_core::{PermissionQueue, RouteTable, RuleTable};

// ── Helpers ─────────────────────────────────────────────────────────

fn make_executor() -> ShellExecutor {
    let route_table = Arc::new(RwLock::new(RouteTable::default()));
    let rule_table = Arc::new(RwLock::new(RuleTable::default()));
    let permissions = Arc::new(RwLock::new(PermissionQueue::default()));
    let audit_buffer = Arc::new(RwLock::new(Vec::new()));
    let admin = crate::admin::AdminHandler::new(
        "test-router".into(),
        route_table,
        rule_table,
    );
    ShellExecutor {
        admin,
        permissions,
        audit_buffer,
        peer_info_fn: Arc::new(|| {
            vec![
                PeerInfo {
                    peer_id: "peer-1".into(),
                    role: "endpoint".into(),
                    connected: true,
                    capabilities: vec!["surface_viewer".into()],
                },
                PeerInfo {
                    peer_id: "child-router".into(),
                    role: "router".into(),
                    connected: true,
                    capabilities: vec![],
                },
            ]
        }),
    }
}
