//! Router state types for JSON persistence.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use gv_core::GrantRecord;

/// Current schema version.
const SCHEMA_VERSION: u32 = 1;

/// Persistent router state.
///
/// Only manual routes, rules, persistent grants, and bounded audit entries
/// are persisted. Learned routes, current peers, and temporary grants are
/// excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterState {
    /// Schema version for forward compatibility.
    pub schema_version: u32,
    /// Node identifier.
    pub node_id: String,
    /// ISO 8601 timestamp of last save.
    pub updated_at: String,
    /// Route table revision at save time.
    pub route_revision: u64,
    /// Rule table revision at save time.
    pub rule_revision: u64,
    /// Permission queue revision at save time.
    pub permission_revision: u64,
    /// Manual routes (learned routes are excluded).
    pub manual_routes: Vec<SerializedRouteEntry>,
    /// Forward rules.
    pub rules: Vec<SerializedRule>,
    /// Persistent grants (Once/Ttl grants are excluded).
    pub persistent_grants: Vec<GrantRecord>,
    /// Bounded audit log (most recent entries).
    pub audit_log: Vec<Value>,
}

/// Serialized route entry (manual only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedRouteEntry {
    pub address: String,
    pub neighbor: String,
    pub distance: u32,
}

/// Serialized rule (flat matcher fields + string action).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedRule {
    pub id: String,
    pub priority: u32,
    pub enabled: bool,
    #[serde(default)]
    pub source_address: Option<String>,
    #[serde(default)]
    pub target_address: Option<String>,
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

impl Default for RouterState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            node_id: String::new(),
            updated_at: String::new(),
            route_revision: 0,
            rule_revision: 0,
            permission_revision: 0,
            manual_routes: Vec::new(),
            rules: Vec::new(),
            persistent_grants: Vec::new(),
            audit_log: Vec::new(),
        }
    }
}
