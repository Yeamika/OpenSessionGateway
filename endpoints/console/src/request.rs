//! Read request builder for the console endpoint.
//!
//! Builds ReadRequest messages for canonical read operations. These are
//! **outbound** messages sent from the console to query runtime state.
//!
//! ## Canonical Request Subtypes
//!
//! The following request subtypes are recognized:
//! - `runtime_workspace_view_snapshot` — Get workspace overview
//! - `runtime_requestion_snapshot` — Get pending requestions
//! - `runtime_session_view_snapshot` — Get session details
//! - `runtime_session_messages` — Get session message history

use anyhow::{bail, Result};
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionId};

/// Build a read request for a canonical request command.
///
/// Returns an error if the command is not in the canonical request subtype list.
pub fn build_request(
    command: &str,
    source: SessionAddress,
    target: SessionAddress,
    message: &str,
) -> Result<ReadRequest> {
    let runtime_id = target.runtime.clone().unwrap_or_else(|| "default".into());
    let session = target.session.clone().unwrap_or_else(|| "default".into());
    let op = match command {
        "runtime_session_view_snapshot" => ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id,
            session_id: SessionId::new(&session),
            requestion_status: text_opt(message).map(str::to_string),
        },
        "runtime_session_messages" => ReadOperation::RuntimeSessionMessages {
            runtime_id,
            session_id: SessionId::new(&session),
            anchor_time: None,
            limit: Some(20),
            regex: text_opt(message).map(str::to_string),
        },
        "runtime_workspace_view_snapshot" => ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id,
            workspace: text_opt(message).map(str::to_string),
        },
        "runtime_requestion_snapshot" => ReadOperation::RuntimeRequestionSnapshot {
            runtime_id,
            session_id: Some(SessionId::new(&session)),
            status: text_opt(message).map(str::to_string),
            blocking: false,
        },
        other => bail!("unsupported request command '{other}'"),
    };
    Ok(ReadRequest::new(source, target, op))
}

pub fn is_request_command(command: &str) -> bool {
    matches!(
        command,
        "runtime_session_view_snapshot"
            | "runtime_session_messages"
            | "runtime_workspace_view_snapshot"
            | "runtime_requestion_snapshot"
    )
}

fn text_opt(value: &str) -> Option<&str> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
