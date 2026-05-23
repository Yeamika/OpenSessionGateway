//! Query endpoint — send cross-domain read requests to remote nodes.
//!
//! A query endpoint can send targeted read requests across domain boundaries.
//! Unlike the observer endpoint (which only sees local router traffic by
//! default), query requests are explicit, targeted operations that can
//! reach any node in the routing graph.
//!
//! ## Request lifecycle
//!
//! 1. Query endpoint builds a `ReadRequest` with `source` address, `request_id`,
//!    `operation` (ReadOperation), and `target`
//! 2. Request is wrapped in `LinkMessage::ReadRequest`
//! 3. Router delivers the request to the target node
//! 4. Target node processes the request and sends a `ReadResponse` back
//! 5. Response is routed back via the source address
//!
//! ## Operations
//!
//! The canonical P-request operations exposed by this helper are:
//!
//! - `runtime_workspace_view_snapshot` — workspace tree, or details when `workspace` is set
//! - `runtime_requestion_snapshot` — pending requestions for a runtime/session
//! - `runtime_session_view_snapshot` — session state plus requestions together
//! - `runtime_session_messages` — messages for a runtime/session

use osgp::{ReadOperation, ReadRequest, ReadResponse, SessionAddress, SessionId};

// ───────────────────────────── Re-exports ─────────────────────────────

pub use osgp::ResponseStatus;

// ───────────────────────────── QuerySurface ─────────────────────────────

/// A query endpoint that can send cross-domain read requests.
///
/// Unlike the observer endpoint (which is passive and local-only), the query
/// endpoint actively sends targeted requests that can cross domain boundaries.
/// Each request carries the source address for reply routing.
pub struct QuerySurface {
    /// The address this query endpoint is registered under.
    pub address: SessionAddress,
    /// The node ID of this query endpoint.
    pub node_id: String,
}

impl QuerySurface {
    /// Create a new query endpoint.
    pub fn new(node_id: impl Into<String>, address: SessionAddress) -> Self {
        Self {
            address,
            node_id: node_id.into(),
        }
    }

    /// Build a [`ReadRequest`] for a cross-domain read operation.
    ///
    /// The request carries the source address so the target node knows
    /// where to route the response.
    pub fn build_request(&self, target: SessionAddress, operation: ReadOperation) -> ReadRequest {
        ReadRequest::new(self.address.clone(), target, operation)
    }

    /// Build a canonical `runtime_workspace_view_snapshot` request.
    ///
    /// `workspace = None` asks for the workspace tree/list. `Some(workspace)` asks
    /// for that workspace's details.
    pub fn build_runtime_workspace_view_snapshot_request(
        &self,
        target: SessionAddress,
        runtime_id: impl Into<String>,
        workspace: Option<String>,
    ) -> ReadRequest {
        self.build_request(
            target,
            ReadOperation::RuntimeWorkspaceViewSnapshot {
                runtime_id: runtime_id.into(),
                workspace,
            },
        )
    }

    /// Build a canonical `runtime_session_messages` request.
    pub fn build_runtime_session_messages_request(
        &self,
        target: SessionAddress,
        runtime_id: impl Into<String>,
        session_id: impl Into<String>,
        limit: Option<u32>,
    ) -> ReadRequest {
        self.build_request(
            target,
            ReadOperation::RuntimeSessionMessages {
                runtime_id: runtime_id.into(),
                session_id: SessionId::new(session_id),
                anchor_time: None,
                limit,
                regex: None,
            },
        )
    }

    /// Build a canonical `runtime_session_view_snapshot` request.
    pub fn build_runtime_session_view_snapshot_request(
        &self,
        target: SessionAddress,
        runtime_id: impl Into<String>,
        session_id: impl Into<String>,
        requestion_status: Option<String>,
    ) -> ReadRequest {
        self.build_request(
            target,
            ReadOperation::RuntimeSessionViewSnapshot {
                runtime_id: runtime_id.into(),
                session_id: SessionId::new(session_id),
                requestion_status,
            },
        )
    }

    /// Build a canonical `runtime_requestion_snapshot` request.
    pub fn build_runtime_requestion_snapshot_request(
        &self,
        target: SessionAddress,
        runtime_id: impl Into<String>,
        session_id: Option<String>,
        status: Option<String>,
        blocking: bool,
    ) -> ReadRequest {
        self.build_request(
            target,
            ReadOperation::RuntimeRequestionSnapshot {
                runtime_id: runtime_id.into(),
                session_id: session_id.map(SessionId::new),
                status,
                blocking,
            },
        )
    }

    /// Deprecated wrapper for the old session-update snapshot builder.
    #[deprecated(note = "use build_runtime_session_view_snapshot_request")]
    pub fn build_session_update_request(
        &self,
        target: SessionAddress,
        session_id: impl Into<String>,
    ) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_session_view_snapshot_request(target, runtime_id, session_id, None)
    }

    /// Deprecated wrapper for the old list-workspaces builder.
    #[deprecated(note = "use build_runtime_workspace_view_snapshot_request")]
    pub fn build_list_workspaces_request(&self, target: SessionAddress) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_workspace_view_snapshot_request(target, runtime_id, None)
    }

    /// Deprecated wrapper for the old read-workspace-info builder.
    #[deprecated(note = "use build_runtime_workspace_view_snapshot_request")]
    pub fn build_read_workspace_info_request(
        &self,
        target: SessionAddress,
        workspace: impl Into<String>,
    ) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_workspace_view_snapshot_request(
            target,
            runtime_id,
            Some(workspace.into()),
        )
    }

    /// Deprecated wrapper for the old session-message-read builder.
    #[deprecated(note = "use build_runtime_session_messages_request")]
    pub fn build_session_message_read_request(
        &self,
        target: SessionAddress,
        session_id: impl Into<String>,
        limit: Option<u32>,
    ) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_session_messages_request(target, runtime_id, session_id, limit)
    }

    /// Deprecated wrapper for the old requestion-snapshot builder.
    #[deprecated(note = "use build_runtime_requestion_snapshot_request")]
    pub fn build_requestion_snapshot_request(
        &self,
        target: SessionAddress,
        session_id: impl Into<String>,
        status: Option<String>,
    ) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_requestion_snapshot_request(
            target,
            runtime_id,
            Some(session_id.into()),
            status,
            false,
        )
    }

    /// Deprecated wrapper for the old session-view-snapshot builder.
    #[deprecated(note = "use build_runtime_session_view_snapshot_request")]
    pub fn build_session_view_snapshot_request(
        &self,
        target: SessionAddress,
        session_id: impl Into<String>,
        requestion_status: Option<String>,
    ) -> ReadRequest {
        let runtime_id = target.runtime.clone().unwrap_or_default();
        self.build_runtime_session_view_snapshot_request(
            target,
            runtime_id,
            session_id,
            requestion_status,
        )
    }

    /// Parse a [`ReadResponse`] from a link message.
    pub fn parse_response(msg: &osgp::LinkMessage) -> Option<ReadResponse> {
        match msg {
            osgp::LinkMessage::ReadResponse(resp) => Some(resp.clone()),
            _ => None,
        }
    }
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests;
