//! Admin request and response types.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use osgp::SessionAddress;

// ── AdminRequest ────────────────────────────────────────────────────

/// Admin requests that can be sent by a connected admin endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AdminRequest {
    // ── Route management ─────────────────────────────────────────
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

    // ── Rule management ──────────────────────────────────────────
    RuleList,
    RuleAdd { rule_def: AdminRuleDef },
    RuleRemove { id: String },
    RuleEnable { id: String },
    RuleDisable { id: String },

    // ── Query ────────────────────────────────────────────────────
    Revision,
    DryRun {
        envelope: osgp::SessionEnvelope,
        from_neighbor: Option<String>,
    },
}

// ── AdminRuleDef ────────────────────────────────────────────────────

/// Wire representation of a rule definition for RuleAdd requests.
/// Uses flat optional fields for matchers and a string-encoded action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminRuleDef {
    pub id: String,
    pub priority: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    // ── Matchers (all optional) ──
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
    // ── Action (string-encoded) ──
    /// Action string: `"drop:<reason>"`, `"force:<neighbor_id>"`,
    /// `"deny:<neighbor_id>"`, or `"continue"`.
    pub action: String,
}

fn default_enabled() -> bool {
    true
}

// ── AdminResponse ───────────────────────────────────────────────────

/// Response from the admin handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
