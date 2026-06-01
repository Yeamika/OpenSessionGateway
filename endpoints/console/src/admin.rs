//! Admin plane helpers for the console endpoint.
//!
//! Builds `admin.request` envelopes and parses `admin.response` replies.
//! The wire format is:
//!
//! ```json
//! {
//!   "type": "envelope",
//!   "kind": "admin.request",
//!   "linkType": "control",
//!   "subtype": "admin_request",
//!   "payload": { "type": "route_list" }
//! }
//! ```
//!
//! Response envelopes arrive as `LinkMessage::Envelope` with `kind = "admin.response"`.
//!
//! ## Internal Admin Exception
//!
//! The subtypes `admin_request` and `admin_response` are **NOT** canonical
//! business subtypes. They are internal router admin plane exceptions used
//! for management operations (route/rule CRUD, permission queries). They
//! should NOT be treated as normal upload/control/request/response business
//! messages and are excluded from the canonical subtype allowlists in
//! `state.rs`.

use anyhow::Result;
use osgp::{SessionAddress, SessionEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── AdminRequest (console-side builder) ──────────────────────────────

/// Mirrors the router's `AdminRequest` enum for serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AdminRequest {
    RouteList,
    RouteListByNeighbor { neighbor: String },
    RouteListManual,
    RouteAdd {
        address: SessionAddress,
        neighbor: String,
        distance: u32,
    },
    RouteRemove {
        address: SessionAddress,
        neighbor: String,
    },
    RuleList,
    RuleAdd { rule_def: AdminRuleDef },
    RuleRemove { id: String },
    RuleEnable { id: String },
    RuleDisable { id: String },
    Revision,
}

/// Console-side rule definition (mirrors router's `AdminRuleDef`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminRuleDef {
    pub id: String,
    pub priority: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub source_address: Option<SessionAddress>,
    #[serde(default)]
    pub target_address: Option<SessionAddress>,
    #[serde(default)]
    pub link_type: Option<String>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub from_neighbor: Option<String>,
    #[serde(default)]
    pub ttl_min: Option<u8>,
    #[serde(default)]
    pub ttl_max: Option<u8>,
    pub action: String,
}

fn default_true() -> bool {
    true
}

// ── AdminResponse (console-side parser) ──────────────────────────────

/// Response from the router admin handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminResponse {
    pub ok: bool,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

impl AdminResponse {
    pub fn ok(data: Value) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(message.into()),
        }
    }
}

// ── Envelope builders ────────────────────────────────────────────────

/// Build an admin.request envelope targeting the router.
///
/// The `source` is the console endpoint address; the `target` is typically
/// a domain-only address (router handles admin locally).
///
/// **Note**: This uses the internal admin exception subtype `admin_request`,
/// which is NOT a canonical business subtype. It is only for router admin
/// plane operations (route/rule CRUD, permission queries).
pub fn build_admin_request(
    request: &AdminRequest,
    source_node_id: &str,
    source: SessionAddress,
    target: SessionAddress,
) -> Result<SessionEnvelope> {
    let payload = serde_json::to_value(request)?;
    Ok(SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source,
        target,
        kind: "admin.request".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_request".to_string(),
        payload,
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: Some(source_node_id.to_string()),
    })
}

/// Try to parse an admin.response from an incoming envelope.
///
/// Returns `Some(AdminResponse)` if the envelope kind is `"admin.response"`.
pub fn parse_admin_response(envelope: &SessionEnvelope) -> Option<AdminResponse> {
    if envelope.kind != "admin.response" {
        return None;
    }
    serde_json::from_value(envelope.payload.clone()).ok()
}

// ── Convenience builders ─────────────────────────────────────────────

pub fn request_route_list() -> AdminRequest {
    AdminRequest::RouteList
}

pub fn request_route_list_manual() -> AdminRequest {
    AdminRequest::RouteListManual
}

pub fn request_route_add(address: SessionAddress, neighbor: &str, distance: u32) -> AdminRequest {
    AdminRequest::RouteAdd {
        address,
        neighbor: neighbor.to_string(),
        distance,
    }
}

pub fn request_route_remove(address: SessionAddress, neighbor: &str) -> AdminRequest {
    AdminRequest::RouteRemove {
        address,
        neighbor: neighbor.to_string(),
    }
}

pub fn request_rule_list() -> AdminRequest {
    AdminRequest::RuleList
}

pub fn request_rule_add(rule_def: AdminRuleDef) -> AdminRequest {
    AdminRequest::RuleAdd { rule_def }
}

pub fn request_rule_remove(id: &str) -> AdminRequest {
    AdminRequest::RuleRemove {
        id: id.to_string(),
    }
}

pub fn request_revision() -> AdminRequest {
    AdminRequest::Revision
}

// ── Display helpers ──────────────────────────────────────────────────

/// Format admin response data for TUI display.
pub fn format_admin_response(resp: &AdminResponse) -> String {
    if !resp.ok {
        return format!(
            "ADMIN ERROR: {}",
            resp.error.as_deref().unwrap_or("unknown")
        );
    }
    let Some(data) = &resp.data else {
        return "ADMIN OK (no data)".to_string();
    };
    serde_json::to_string_pretty(data).unwrap_or_else(|_| data.to_string())
}
