use anyhow::Result;
use osgp::{
    Envelope, LinkMessage, Payload, ReadRequest, ReadResponse, ResponseStatus, RouteTarget,
    SessionAddress, SessionState, SessionUpdate,
};
use osgp_client::{Transport, WebSocketTransportHandle};
use serde_json::json;
use tokio::time::{Duration, Instant};
use tracing::info;

pub struct DemoProfile {
    pub label: &'static str,
    pub node_id: &'static str,
    pub session: &'static str,
    pub state: SessionState,
    pub title: &'static str,
    pub summary: &'static str,
    pub metadata: serde_json::Value,
}

pub async fn send_hello_handshake(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    address: &SessionAddress,
) -> Result<()> {
    let hello = json!({
        "nodeId": node_id,
        "role": "endpoint",
        "addresses": [address],
        "capabilities": [
            "runtime_workspace_view_snapshot",
            "runtime_requestion_snapshot",
            "runtime_session_view_snapshot",
            "runtime_session_messages"
        ],
    });
    transport
        .send_raw_text(&serde_json::to_string(&hello)?)
        .await?;
    info!(node_id = %node_id, "sent Hello handshake");

    match tokio::time::timeout(Duration::from_millis(500), transport.receive_raw_text()).await {
        Ok(Ok(Some(reply_text))) => info!(reply = %reply_text, "received router Hello reply"),
        _ => info!("no Hello reply from router (normal for downstream)"),
    }
    Ok(())
}

pub async fn announce_and_upload(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    address: &SessionAddress,
    update: SessionUpdate,
) -> Result<String> {
    transport
        .send_message(LinkMessage::Announce {
            address: address.clone(),
            distance: 0,
        })
        .await?;
    println!("  OK: Announce sent for {}", format_address(address));

    let envelope = Envelope::new(
        RouteTarget::address(address.clone()),
        RouteTarget::session(node_id, update.session_id.0.clone()),
        Payload::SessionUpdate(update),
    );
    let message_id = envelope.message_id.clone();
    transport
        .send_message(LinkMessage::TypedEnvelope(envelope))
        .await?;
    Ok(message_id)
}

pub async fn live_loop(
    transport: &WebSocketTransportHandle,
    profile: &DemoProfile,
    address: &SessionAddress,
    listen_seconds: u64,
) -> Result<()> {
    if listen_seconds == 0 {
        println!("[5/6] Live receive disabled (--listen-seconds 0).");
        return Ok(());
    }

    println!(
        "[5/6] Live receive window: {}s (control/request handling enabled)...",
        listen_seconds
    );
    let deadline = Instant::now() + Duration::from_secs(listen_seconds);
    let mut seen = 0usize;

    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match tokio::time::timeout(deadline - now, transport.receive_message()).await {
            Ok(Ok(Some(message))) => {
                seen += 1;
                handle_message(transport, profile, address, message).await?;
            }
            Ok(Ok(None)) => {
                println!("  WARN: router connection closed");
                break;
            }
            Ok(Err(err)) => {
                println!("  ERR: receive error: {err}");
                break;
            }
            Err(_) => break,
        }
    }

    println!("  OK: live window ended; messages processed = {seen}");
    Ok(())
}

async fn handle_message(
    transport: &WebSocketTransportHandle,
    profile: &DemoProfile,
    address: &SessionAddress,
    message: LinkMessage,
) -> Result<()> {
    match message {
        LinkMessage::ReadRequest(request) => {
            handle_read_request(transport, profile, address, request).await
        }
        LinkMessage::TypedEnvelope(envelope) => {
            handle_typed_envelope(transport, profile, address, envelope).await
        }
        LinkMessage::Envelope(envelope) => {
            println!(
                "  RX compat envelope type/sub={}/{} kind={} source={:?} target={:?}",
                envelope.link_type,
                envelope.subtype,
                envelope.kind,
                envelope.source,
                envelope.target
            );
            if envelope.link_type == "control" {
                println!(
                    "  CONTROL compat subtype={} payload={}",
                    envelope.subtype, envelope.payload
                );
                let response = ReadResponse::new(
                    address.clone(),
                    envelope.source.clone(),
                    &envelope.subtype,
                    envelope.id.to_string(),
                    envelope.id.to_string(),
                    ResponseStatus::Ok,
                    json!({"ok": true, "handledBy": profile.node_id, "smoke": true}),
                );
                transport
                    .send_message(LinkMessage::ReadResponse(response))
                    .await?;
                println!(
                    "  TX smoke response for control subtype={}",
                    envelope.subtype
                );
            }
            Ok(())
        }
        LinkMessage::Ping => {
            println!("  RX ping -> TX pong");
            transport.send_message(LinkMessage::Pong).await
        }
        LinkMessage::Pong => {
            println!("  RX pong");
            Ok(())
        }
        LinkMessage::Announce { address, distance } => {
            println!(
                "  RX announce address={} distance={distance}",
                format_address(&address)
            );
            Ok(())
        }
        LinkMessage::ReadResponse(response) => {
            println!(
                "  RX ReadResponse subtype={} status={:?} request_id={}",
                response.subtype, response.status, response.request_id
            );
            Ok(())
        }
    }
}

async fn handle_read_request(
    transport: &WebSocketTransportHandle,
    profile: &DemoProfile,
    address: &SessionAddress,
    request: ReadRequest,
) -> Result<()> {
    println!(
        "  RX ReadRequest subtype={} op={} request_id={} source={} target={}",
        request.subtype,
        request.operation.op_name(),
        request.request_id,
        format_address(&request.source),
        format_address(&request.target)
    );

    let payload = match request.subtype.as_str() {
        "runtime_workspace_view_snapshot" => json!({
            "runtimeId": address.runtime,
            "workspace": profile.label,
            "tree": [{"name": profile.label, "kind": "demo-runtime"}],
        }),
        "runtime_requestion_snapshot" => json!({
            "runtimeId": address.runtime,
            "sessionId": address.session,
            "requestions": [],
        }),
        "runtime_session_view_snapshot" => json!({
            "runtimeId": address.runtime,
            "sessionId": address.session,
            "state": format!("{:?}", profile.state),
            "title": profile.title,
            "summary": profile.summary,
        }),
        "runtime_session_messages" => json!({
            "runtimeId": address.runtime,
            "sessionId": address.session,
            "messages": [{"role": "system", "text": profile.summary}],
        }),
        other => json!({"unsupportedSubtype": other, "handledBy": profile.node_id}),
    };

    let response = ReadResponse::ok_for_request(address, &request, payload);
    transport
        .send_message(LinkMessage::ReadResponse(response))
        .await?;
    println!(
        "  TX ReadResponse subtype={} request_id={}",
        request.subtype, request.request_id
    );
    Ok(())
}

async fn handle_typed_envelope(
    transport: &WebSocketTransportHandle,
    profile: &DemoProfile,
    address: &SessionAddress,
    envelope: Envelope,
) -> Result<()> {
    println!(
        "  RX typed envelope id={} type/sub={}/{} source={:?} target={:?}",
        envelope.message_id,
        envelope.link_type.as_wire(),
        envelope.subtype,
        envelope.source,
        envelope.target
    );

    match envelope.payload {
        Payload::SessionCommand(command) => {
            println!(
                "  CONTROL typed subtype={} command={} payload={}",
                command.subtype.as_wire(),
                command.command,
                command.payload
            );
            let target = route_target_address(&envelope.source).unwrap_or_else(|| address.clone());
            let response = ReadResponse::new(
                address.clone(),
                target,
                command.subtype.as_wire(),
                &envelope.message_id,
                &envelope.message_id,
                ResponseStatus::Ok,
                json!({"ok": true, "handledBy": profile.node_id, "smoke": true}),
            );
            transport
                .send_message(LinkMessage::ReadResponse(response))
                .await?;
            println!(
                "  TX smoke response for control subtype={}",
                command.subtype.as_wire()
            );
        }
        Payload::Text(value) if envelope.link_type.as_wire() == "request" => {
            println!(
                "  REQUEST typed text subtype={} payload={}",
                envelope.subtype, value
            );
        }
        other => println!("  RX typed payload={other:?}"),
    }
    Ok(())
}

fn route_target_address(target: &RouteTarget) -> Option<SessionAddress> {
    match target {
        RouteTarget::Address { address } => Some(address.clone()),
        _ => None,
    }
}

pub fn build_update(profile: &DemoProfile) -> SessionUpdate {
    SessionUpdate {
        session_id: profile.session.into(),
        state: profile.state.clone(),
        title: Some(profile.title.into()),
        summary: Some(profile.summary.into()),
        metadata: Some(profile.metadata.clone()),
    }
}

pub fn format_address(address: &SessionAddress) -> String {
    match (&address.runtime, &address.session) {
        (Some(runtime), Some(session)) => format!("{}/{}/{}", address.domain, runtime, session),
        (Some(runtime), None) => format!("{}/{}/*", address.domain, runtime),
        (None, Some(session)) => format!("{}/*/{}", address.domain, session),
        (None, None) => format!("{}/*/*", address.domain),
    }
}
