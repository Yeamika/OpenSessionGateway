//! Permission request types.

use serde::{Deserialize, Serialize};

// ── PermissionOp ────────────────────────────────────────────────────

/// Protocol-level operations that can be requested/granted.
///
/// These are abstracted from legacy business concepts. Each variant
/// corresponds to a capability the admin/policy system can evaluate.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOp {
    /// Observe session_update uploads (read-only observer).
    ObserveSessionUpdate,
    /// Read runtime session messages.
    ReadRuntimeSessionMessages,
    /// Send control.add_prompt or similar control operations.
    ControlAddPrompt,
    /// Read forwarding routes.
    AdminRoutesRead,
    /// Write (add/remove) forwarding routes.
    AdminRoutesWrite,
    /// Read policy/forward rules.
    AdminRulesRead,
    /// Write (add/remove/enable/disable) policy/forward rules.
    AdminRulesWrite,
    /// Announce routes to this router.
    AnnounceRoute,
}

impl PermissionOp {
    /// Canonical wire string for this operation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ObserveSessionUpdate => "observe.session_update",
            Self::ReadRuntimeSessionMessages => "read.runtime_session_messages",
            Self::ControlAddPrompt => "control.add_prompt",
            Self::AdminRoutesRead => "admin.routes.read",
            Self::AdminRoutesWrite => "admin.routes.write",
            Self::AdminRulesRead => "admin.rules.read",
            Self::AdminRulesWrite => "admin.rules.write",
            Self::AnnounceRoute => "announce.route",
        }
    }

    /// Parse from a wire string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "observe.session_update" => Some(Self::ObserveSessionUpdate),
            "read.runtime_session_messages" => Some(Self::ReadRuntimeSessionMessages),
            "control.add_prompt" => Some(Self::ControlAddPrompt),
            "admin.routes.read" => Some(Self::AdminRoutesRead),
            "admin.routes.write" => Some(Self::AdminRoutesWrite),
            "admin.rules.read" => Some(Self::AdminRulesRead),
            "admin.rules.write" => Some(Self::AdminRulesWrite),
            "announce.route" => Some(Self::AnnounceRoute),
            _ => None,
        }
    }
}

// ── PermissionStatus ────────────────────────────────────────────────

/// Status of a permission request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Pending,
    Approved,
    Denied,
}

// ── ApprovalKind ────────────────────────────────────────────────────

/// How a permission was approved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalKind {
    /// One-time approval (single use).
    Once,
    /// Time-to-live approval (seconds).
    Ttl { seconds: u64 },
    /// Persistent approval (survives restart).
    Persist,
}

// ── PermissionRequest ───────────────────────────────────────────────

/// A permission request from a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    /// Unique request ID (assigned by the queue).
    pub id: String,
    /// The peer that made the request.
    pub peer_id: String,
    /// The operation being requested.
    pub op: PermissionOp,
    /// Current status.
    pub status: PermissionStatus,
}

// ── GrantRecord ─────────────────────────────────────────────────────

/// An active grant for a peer+op pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantRecord {
    pub peer_id: String,
    pub op: PermissionOp,
    pub kind: ApprovalKind,
}
