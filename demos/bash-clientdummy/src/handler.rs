//! Inbound message handling: control commands, read requests, ping/pong.

use std::collections::HashMap;

use anyhow::Result;
use osgp::{
    Envelope, LinkMessage, Payload, ReadRequest, ReadResponse, ResponseStatus, SessionAddress,
    SessionState,
};
use osgp_client::{Transport, WebSocketTransportHandle};
use serde_json::json;
use tracing::{info, warn};

use crate::protocol::{
    build_control_smoke_response, build_response_for_request,
    format_address,
};

/// Per-session mutable state tracked by the dummy.
#[derive(Clone, Debug)]
pub struct SessionStateTracker {
    pub session_id: String,
    pub state: SessionState,
    pub title: String,
    pub messages: Vec<(String, String)>, // (role, text)
}

impl SessionStateTracker {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            state: SessionState::Running,
            title: format!("session {session_id}"),
            messages: Vec::new(),
        }
    }
}

/// Handle any inbound LinkMessage and optionally send responses.
pub async fn handle_message(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    runtime_id: &str,
    address: &SessionAddress,
    sessions: &mut HashMap<String, SessionStateTracker>,
    message: LinkMessage,
) -> Result<()> {
    match message {
        LinkMessage::ReadRequest(request) => {
            handle_read_request(transport, node_id, runtime_id, address, sessions, request).await
        }
        LinkMessage::TypedEnvelope(envelope) => {
            handle_typed_envelope(transport, node_id, address, sessions, envelope).await
        }
        LinkMessage::Envelope(envelope) => {
            handle_compat_envelope(transport, node_id, address, envelope).await
        }
        LinkMessage::Ping => {
            info!("RX ping -> TX pong");
            transport.send_message(LinkMessage::Pong).await
        }
        LinkMessage::Pong => {
            info!("RX pong");
            Ok(())
        }
        LinkMessage::Announce {
            address: addr,
            distance,
        } => {
            info!(
                "RX announce address={} distance={}",
                format_address(&addr),
                distance
            );
            Ok(())
        }
        LinkMessage::ReadResponse(response) => {
            info!(
                "RX ReadResponse subtype={} status={:?} request_id={}",
                response.subtype, response.status, response.request_id
            );
            Ok(())
        }
    }
}

async fn handle_read_request(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    runtime_id: &str,
    address: &SessionAddress,
    sessions: &mut HashMap<String, SessionStateTracker>,
    request: ReadRequest,
) -> Result<()> {
    info!(
        "RX ReadRequest subtype={} request_id={} source={} target={}",
        request.subtype,
        request.request_id,
        format_address(&request.source),
        format_address(&request.target)
    );

    let payload = match request.subtype.as_str() {
        "runtime_workspace_view_snapshot" => json!({
            "runtimeId": runtime_id,
            "workspace": node_id,
            "tree": [{"name": node_id, "kind": "bash-clientdummy"}],
        }),
        "runtime_requestion_snapshot" => json!({
            "runtimeId": runtime_id,
            "requestions": [],
        }),
        "runtime_session_view_snapshot" => {
            // Try to extract session ID from target or operation
            let session_id = extract_session_from_request(&request);
            match session_id.and_then(|sid| sessions.get(&sid)) {
                Some(tracker) => json!({
                    "runtimeId": runtime_id,
                    "sessionId": tracker.session_id,
                    "state": format!("{:?}", tracker.state),
                    "title": tracker.title,
                }),
                None => json!({
                    "runtimeId": runtime_id,
                    "error": "session not found",
                }),
            }
        }
        "runtime_session_messages" => {
            let session_id = extract_session_from_request(&request);
            match session_id.and_then(|sid| sessions.get(&sid)) {
                Some(tracker) => {
                    let msgs: Vec<serde_json::Value> = tracker
                        .messages
                        .iter()
                        .map(|(role, text)| json!({"role": role, "text": text}))
                        .collect();
                    json!({
                        "runtimeId": runtime_id,
                        "sessionId": tracker.session_id,
                        "messages": msgs,
                    })
                }
                None => json!({
                    "runtimeId": runtime_id,
                    "error": "session not found",
                }),
            }
        }
        other => {
            warn!("unsupported request subtype: {}", other);
            json!({"unsupportedSubtype": other, "handledBy": node_id})
        }
    };

    let response = build_response_for_request(address, &request, payload);
    transport
        .send_message(LinkMessage::ReadResponse(response))
        .await?;
    info!("TX ReadResponse subtype={}", request.subtype);
    Ok(())
}

async fn handle_typed_envelope(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    address: &SessionAddress,
    sessions: &mut HashMap<String, SessionStateTracker>,
    envelope: Envelope,
) -> Result<()> {
    info!(
        "RX typed envelope type/sub={}/{} id={}",
        envelope.link_type.as_wire(),
        envelope.subtype,
        envelope.message_id
    );

    match envelope.payload {
        Payload::SessionCommand(command) => {
            let subtype = command.subtype.as_wire();
            info!("CONTROL subtype={} command={}", subtype, command.command);

            // Apply side effects for known commands
            match command.subtype {
                osgp::SessionCommandKind::AbortSession { ref session_id } => {
                    if let Some(tracker) = sessions.get_mut(&session_id.0) {
                        tracker.state = SessionState::Closed;
                        info!("session {} aborted", session_id);
                    }
                }
                osgp::SessionCommandKind::CompactSession { ref session_id } => {
                    info!("session {} compact requested", session_id);
                }
                osgp::SessionCommandKind::ResumeSession { ref session_id } => {
                    if let Some(tracker) = sessions.get_mut(&session_id.0) {
                        tracker.state = SessionState::Running;
                        info!("session {} resumed", session_id);
                    }
                }
                osgp::SessionCommandKind::AddPrompt { ref session_id } => {
                    info!("session {} add_prompt", session_id);
                }
                osgp::SessionCommandKind::CreateSession {
                    ref session_id,
                } => {
                    info!("session {} create requested", session_id);
                }
                osgp::SessionCommandKind::RenameSession {
                    ref session_id,
                    ref new_name,
                } => {
                    if let Some(tracker) = sessions.get_mut(&session_id.0) {
                        tracker.title = new_name.clone();
                        info!("session {} renamed to {}", session_id, new_name);
                    }
                }
                osgp::SessionCommandKind::RequestionRespond {
                    ref session_id,
                    ref requestion_id,
                } => {
                    info!(
                        "session {} requestion_respond id={}",
                        session_id, requestion_id
                    );
                }
            }

            // Send smoke response
            let source_addr = route_target_to_address(&envelope.source)
                .unwrap_or_else(|| address.clone());
            let response = build_control_smoke_response(
                address,
                &envelope.message_id,
                subtype,
                &source_addr,
                node_id,
            );
            transport
                .send_message(LinkMessage::ReadResponse(response))
                .await?;
            info!("TX smoke response for control subtype={}", subtype);
        }
        Payload::Text(ref value) if envelope.link_type.as_wire() == "request" => {
            info!("REQUEST typed text subtype={} payload={}", envelope.subtype, value);
        }
        _ => {
            info!("RX typed payload (unhandled)");
        }
    }
    Ok(())
}

async fn handle_compat_envelope(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    address: &SessionAddress,
    envelope: osgp::SessionEnvelope,
) -> Result<()> {
    info!(
        "RX compat envelope type/sub={}/{} kind={}",
        envelope.link_type, envelope.subtype, envelope.kind
    );

    if envelope.link_type == "control" {
        info!("CONTROL compat subtype={}", envelope.subtype);
        let response = ReadResponse::new(
            address.clone(),
            envelope.source.clone(),
            &envelope.subtype,
            envelope.id.to_string(),
            envelope.id.to_string(),
            ResponseStatus::Ok,
            json!({"ok": true, "handledBy": node_id, "smoke": true}),
        );
        transport
            .send_message(LinkMessage::ReadResponse(response))
            .await?;
        info!("TX smoke response for compat control subtype={}", envelope.subtype);
    }
    Ok(())
}

/// Try to extract a session ID from a ReadRequest.
fn extract_session_from_request(request: &ReadRequest) -> Option<String> {
    // Try from target.session
    if let Some(ref sid) = request.target.session {
        return Some(sid.clone());
    }
    None
}

/// Convert a RouteTarget to a SessionAddress if it's address-based.
fn route_target_to_address(target: &osgp::RouteTarget) -> Option<SessionAddress> {
    match target {
        osgp::RouteTarget::Address { address } => Some(address.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_state_tracker_new() {
        let tracker = SessionStateTracker::new("s1");
        assert_eq!(tracker.session_id, "s1");
        assert_eq!(tracker.state, SessionState::Running);
        assert!(tracker.messages.is_empty());
    }

    #[test]
    fn test_extract_session_from_request() {
        let addr = SessionAddress::new("east", Some("rt-1".into()), Some("s1".into()));
        let request = osgp::ReadRequest::new(
            addr.clone(),
            addr.clone(),
            osgp::ReadOperation::RuntimeSessionMessages {
                runtime_id: "rt-1".into(),
                session_id: "s1".into(),
                anchor_time: None,
                limit: None,
                regex: None,
            },
        );
        assert_eq!(extract_session_from_request(&request), Some("s1".into()));
    }

    #[test]
    fn test_extract_session_from_request_no_session() {
        let addr = SessionAddress::new("east", Some("rt-1".into()), None);
        let request = osgp::ReadRequest::new(
            addr.clone(),
            addr.clone(),
            osgp::ReadOperation::RuntimeWorkspaceViewSnapshot {
                runtime_id: "rt-1".into(),
                workspace: None,
            },
        );
        assert_eq!(extract_session_from_request(&request), None);
    }
}
