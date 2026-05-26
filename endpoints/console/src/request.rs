use anyhow::{bail, Result};
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionId};

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
