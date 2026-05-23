//! Read request/response types and operations.
//!
//! # Canonical request subtypes (P-request)
//!
//! The read (request) path converges on four canonical subtypes:
//!
//! | Canonical subtype | Semantic |
//! |---|---|
//! | `runtime_workspace_view_snapshot` | Read workspace tree or specific workspace info from a runtime |
//! | `runtime_requestion_snapshot` | Read pending requestions from a runtime |
//! | `runtime_session_view_snapshot` | Read session state snapshot from a runtime (covers session_update, session_view, session_update_subscribe) |
//! | `runtime_session_messages` | Read session message timeline |
//!
//! Legacy variants (`ListWorkspaces`, `SessionUpdateSnapshot`, etc.) are kept as
//! compatibility aliases. Their `subtype()` / `op_name()` return canonical values
//! so that wire output is always canonical regardless of which variant is used.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::address::{SessionAddress, SessionId};
use crate::validation::{validate_non_empty, ValidationError};

// ── ReadOperation ────────────────────────────────────────────────────

/// Read operation variants.
///
/// **Canonical variants** (preferred):
/// - `RuntimeWorkspaceViewSnapshot` — `runtime_workspace_view_snapshot`
/// - `RuntimeRequestionSnapshot` — `runtime_requestion_snapshot`
/// - `RuntimeSessionViewSnapshot` — `runtime_session_view_snapshot`
/// - `RuntimeSessionMessages` — `runtime_session_messages`
///
/// **Compat aliases** (deprecated, map to canonical on the wire):
/// - `ListWorkspaces` → `runtime_workspace_view_snapshot` (no workspace specified)
/// - `ReadWorkspaceInfo` → `runtime_workspace_view_snapshot` (workspace specified)
/// - `ListSessionMessages` → `runtime_session_messages`
/// - `SessionUpdateSnapshot` → `runtime_session_view_snapshot`
/// - `RequestionSnapshot` → `runtime_session_view_snapshot`
/// - `SessionViewSnapshot` → `runtime_session_view_snapshot`
/// - `SessionUpdateSubscribe` → `runtime_session_view_snapshot`
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadOperation {
    // ── Canonical ───────────────────────────────────────────────────
    /// Read runtime workspace view. Without `workspace` returns the workspace
    /// tree; with `workspace` returns detailed info for that workspace.
    RuntimeWorkspaceViewSnapshot {
        #[serde(rename = "runtimeId")]
        runtime_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace: Option<String>,
    },

    /// Read pending requestions for a runtime (optionally filtered by session/status).
    RuntimeRequestionSnapshot {
        #[serde(rename = "runtimeId")]
        runtime_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<SessionId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(default)]
        blocking: bool,
    },

    /// Read runtime session state snapshot. Covers the snapshot semantics of
    /// the former `session_update_snapshot`, `session_view_snapshot`, and
    /// `session_update_subscribe`.
    RuntimeSessionViewSnapshot {
        #[serde(rename = "runtimeId")]
        runtime_id: String,
        session_id: SessionId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        requestion_status: Option<String>,
    },

    /// Read session message timeline.
    RuntimeSessionMessages {
        #[serde(rename = "runtimeId")]
        runtime_id: String,
        session_id: SessionId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor_time: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        regex: Option<String>,
    },

    // ── Compat aliases (deprecated) ─────────────────────────────────
    /// Compat alias for `RuntimeWorkspaceViewSnapshot` (no workspace).
    #[deprecated(note = "Use RuntimeWorkspaceViewSnapshot without workspace")]
    ListWorkspaces,

    /// Compat alias for `RuntimeWorkspaceViewSnapshot` (with workspace).
    #[deprecated(note = "Use RuntimeWorkspaceViewSnapshot with workspace")]
    ReadWorkspaceInfo { workspace: String },

    /// Compat alias for `RuntimeSessionMessages`.
    #[deprecated(note = "Use RuntimeSessionMessages")]
    ListSessionMessages {
        session_id: SessionId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor_time: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        regex: Option<String>,
    },

    /// Compat alias for `RuntimeSessionViewSnapshot`.
    #[deprecated(note = "Use RuntimeSessionViewSnapshot")]
    SessionUpdateSnapshot { session_id: SessionId },

    /// Compat alias for `RuntimeSessionViewSnapshot`.
    #[deprecated(note = "Use RuntimeSessionViewSnapshot")]
    RequestionSnapshot {
        session_id: SessionId,
        status: Option<String>,
    },

    /// Compat alias for `RuntimeSessionViewSnapshot` (session + requestion).
    #[deprecated(note = "Use RuntimeSessionViewSnapshot")]
    SessionViewSnapshot {
        session_id: SessionId,
        requestion_status: Option<String>,
    },

    /// Compat alias for `RuntimeSessionViewSnapshot` (subscribe semantics).
    #[deprecated(note = "Use RuntimeSessionViewSnapshot; subscribe is not a canonical subtype")]
    SessionUpdateSubscribe { session_id: SessionId },
}

impl ReadOperation {
    /// Returns the canonical wire subtype string.
    ///
    /// All variants (including deprecated aliases) return one of the four
    /// canonical subtype strings.
    pub fn subtype(&self) -> &'static str {
        match self {
            // Canonical
            Self::RuntimeWorkspaceViewSnapshot { .. } => "runtime_workspace_view_snapshot",
            Self::RuntimeRequestionSnapshot { .. } => "runtime_requestion_snapshot",
            Self::RuntimeSessionViewSnapshot { .. } => "runtime_session_view_snapshot",
            Self::RuntimeSessionMessages { .. } => "runtime_session_messages",
            // Compat → canonical
            Self::ListWorkspaces => "runtime_workspace_view_snapshot",
            Self::ReadWorkspaceInfo { .. } => "runtime_workspace_view_snapshot",
            Self::ListSessionMessages { .. } => "runtime_session_messages",
            Self::SessionUpdateSnapshot { .. } => "runtime_session_view_snapshot",
            Self::RequestionSnapshot { .. } => "runtime_session_view_snapshot",
            Self::SessionViewSnapshot { .. } => "runtime_session_view_snapshot",
            Self::SessionUpdateSubscribe { .. } => "runtime_session_view_snapshot",
        }
    }

    /// Returns the canonical camelCase op_name used in wire JSON.
    pub fn op_name(&self) -> &'static str {
        match self {
            // Canonical
            Self::RuntimeWorkspaceViewSnapshot { .. } => "runtimeWorkspaceViewSnapshot",
            Self::RuntimeRequestionSnapshot { .. } => "runtimeRequestionSnapshot",
            Self::RuntimeSessionViewSnapshot { .. } => "runtimeSessionViewSnapshot",
            Self::RuntimeSessionMessages { .. } => "runtimeSessionMessages",
            // Compat → canonical
            Self::ListWorkspaces => "runtimeWorkspaceViewSnapshot",
            Self::ReadWorkspaceInfo { .. } => "runtimeWorkspaceViewSnapshot",
            Self::ListSessionMessages { .. } => "runtimeSessionMessages",
            Self::SessionUpdateSnapshot { .. } => "runtimeSessionViewSnapshot",
            Self::RequestionSnapshot { .. } => "runtimeSessionViewSnapshot",
            Self::SessionViewSnapshot { .. } => "runtimeSessionViewSnapshot",
            Self::SessionUpdateSubscribe { .. } => "runtimeSessionViewSnapshot",
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::RuntimeWorkspaceViewSnapshot { runtime_id, .. } => {
                validate_non_empty("runtimeId", runtime_id)
            }
            Self::RuntimeRequestionSnapshot { runtime_id, .. } => {
                validate_non_empty("runtimeId", runtime_id)
            }
            Self::RuntimeSessionViewSnapshot {
                runtime_id,
                session_id,
                ..
            } => {
                validate_non_empty("runtimeId", runtime_id)?;
                session_id.validate()
            }
            Self::RuntimeSessionMessages {
                runtime_id,
                session_id,
                ..
            } => {
                validate_non_empty("runtimeId", runtime_id)?;
                session_id.validate()
            }
            // Compat — keep existing validation logic
            Self::ListSessionMessages { session_id, .. }
            | Self::SessionUpdateSnapshot { session_id }
            | Self::RequestionSnapshot { session_id, .. }
            | Self::SessionViewSnapshot { session_id, .. }
            | Self::SessionUpdateSubscribe { session_id } => session_id.validate(),
            Self::ListWorkspaces | Self::ReadWorkspaceInfo { .. } => Ok(()),
        }
    }
}

// ── ResponseStatus ───────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseStatus {
    Ok,
    PermissionDenied,
    NotFound,
    Error,
}

// ── ReadRequest ──────────────────────────────────────────────────────

/// Read request from an endpoint to a router.
///
/// # Address model
///
/// - `source` — address of the requesting endpoint (reply-to address).
///   The router uses this to route responses back.
/// - `target` — address of the queried runtime/session.
/// - `request_id` / `trace_id` — correlation only; NOT used for routing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub request_id: String,
    pub trace_id: String,
    /// Canonical: address of the requesting endpoint (reply-to).
    pub source: SessionAddress,
    /// Canonical: address of the queried runtime/session.
    pub target: SessionAddress,
    pub operation: ReadOperation,
    pub link_type: String,
    /// Canonical read operation subtype.
    pub subtype: String,
    pub ttl: u8,
    #[serde(default)]
    pub route_hops: Vec<String>,
}

impl ReadRequest {
    /// Create a new canonical read request with address-level source/target.
    pub fn new(source: SessionAddress, target: SessionAddress, operation: ReadOperation) -> Self {
        let subtype = operation.subtype().to_string();
        Self {
            request_id: Uuid::new_v4().to_string(),
            trace_id: Uuid::new_v4().to_string(),
            source,
            target,
            operation,
            link_type: "request".into(),
            subtype,
            ttl: 32,
            route_hops: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        self.source.validate()?;
        self.target.validate()?;
        validate_non_empty("type", &self.link_type)?;
        validate_non_empty("subtype", &self.subtype)?;
        if self.link_type != "request" {
            return Err(ValidationError::FieldMismatch {
                field: "link_type".into(),
                reason: "must be 'request'".into(),
            });
        }
        if self.subtype != self.operation.subtype() {
            return Err(ValidationError::FieldMismatch {
                field: "subtype".into(),
                reason: "does not match operation subtype".into(),
            });
        }
        Ok(())
    }
}

// ── ReadResponse ─────────────────────────────────────────────────────

/// Response to a read request.
///
/// # Address model
///
/// - `source` — address of the responding runtime/endpoint.
/// - `target` — address the response is sent to (= original request's `source`).
/// - `request_id` / `trace_id` — correlation only; NOT used for routing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResponse {
    pub request_id: String,
    pub trace_id: String,
    /// Canonical: address of the responding runtime/endpoint.
    pub source: SessionAddress,
    /// Canonical: reply-to address (= original request's `source`).
    pub target: SessionAddress,
    pub status: ResponseStatus,
    pub payload: Value,
    pub link_type: String,
    /// Canonical subtype echoed from the corresponding request.
    pub subtype: String,
}

impl ReadResponse {
    /// Build a successful response for a given request.
    ///
    /// Automatically sets:
    /// - `source` = `responder_source` (the runtime/endpoint sending this response)
    /// - `target` = `request.source` (reply to the original requestor)
    /// - `subtype` = `request.subtype` (echoed)
    /// - `request_id` / `trace_id` copied from request for correlation.
    pub fn ok_for_request(
        responder_source: &SessionAddress,
        request: &ReadRequest,
        payload: Value,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            trace_id: request.trace_id.clone(),
            source: responder_source.clone(),
            target: request.source.clone(),
            status: ResponseStatus::Ok,
            payload,
            link_type: "response".into(),
            subtype: request.subtype.clone(),
        }
    }

    /// Build an error response for a given request.
    pub fn error_for_request(
        responder_source: &SessionAddress,
        request: &ReadRequest,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            trace_id: request.trace_id.clone(),
            source: responder_source.clone(),
            target: request.source.clone(),
            status: ResponseStatus::Error,
            payload: serde_json::json!({ "reason": reason.into() }),
            link_type: "response".into(),
            subtype: request.subtype.clone(),
        }
    }

    /// Build a not-found response for a given request.
    pub fn not_found_for_request(
        responder_source: &SessionAddress,
        request: &ReadRequest,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            trace_id: request.trace_id.clone(),
            source: responder_source.clone(),
            target: request.source.clone(),
            status: ResponseStatus::NotFound,
            payload: serde_json::json!({ "reason": reason.into() }),
            link_type: "response".into(),
            subtype: request.subtype.clone(),
        }
    }

    /// Build a permission-denied response for a given request.
    pub fn permission_denied_for_request(
        responder_source: &SessionAddress,
        request: &ReadRequest,
        reason: &str,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            trace_id: request.trace_id.clone(),
            source: responder_source.clone(),
            target: request.source.clone(),
            status: ResponseStatus::PermissionDenied,
            payload: serde_json::json!({ "reason": reason }),
            link_type: "response".into(),
            subtype: request.subtype.clone(),
        }
    }

    /// Low-level constructor for custom response building.
    /// Prefer `ok_for_request` / `error_for_request` / etc.
    pub fn new(
        source: SessionAddress,
        target: SessionAddress,
        subtype: impl Into<String>,
        request_id: impl Into<String>,
        trace_id: impl Into<String>,
        status: ResponseStatus,
        payload: Value,
    ) -> Self {
        Self {
            request_id: request_id.into(),
            trace_id: trace_id.into(),
            source,
            target,
            status,
            payload,
            link_type: "response".into(),
            subtype: subtype.into(),
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self.status, ResponseStatus::Ok)
    }
}
