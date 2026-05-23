//! Local validation harness for a multi-router GlassVein network.
//!
//! This demo uses real WebSocket links through either the default router
//! listener (tokio + tungstenite) or the feature-gated Pingora listener. It
//! intentionally stays in `demos/` so router/core semantics are validated
//! without adding business meaning to `core`.
//!
//! Usage:
//!   cargo run -p glassvein-demos --bin gv-network-validation
//!   cargo run -p glassvein-demos --bin gv-network-validation -- --base-port 7350
//!   cargo run -p glassvein-demos --bin gv-network-validation -- --listener pingora

use std::sync::Arc;

use anyhow::{bail, Context, Result};
use osgp_client::{Transport, WebSocketTransportHandle};
use router::{ListenerBackend, RouterConfig, RouterNode};
use serde_json::json;
use osgp::{
    LinkMessage, ReadOperation, ReadRequest, ReadResponse, RouteTarget, SessionAddress, SessionEnvelope,
    SessionId,
};
use tokio::time::{sleep, timeout, Duration};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse()?;

    let root_addr = format!("127.0.0.1:{}", args.base_port);
    let east_addr = format!("127.0.0.1:{}", args.base_port + 1);
    let root_url = format!("ws://{root_addr}");
    let east_url = format!("ws://{east_addr}");

    let alpha_addr = SessionAddress::new(
        "domain-a",
        Some("runtime-alpha".into()),
        Some("session-alpha".into()),
    );
    let control_addr = SessionAddress::new(
        "control-domain",
        Some("runtime-control".into()),
        Some("session-control".into()),
    );

    println!("==============================================================");
    println!("  GlassVein GV network validation harness");
    println!("==============================================================");
    println!("  listener backend : {:?}", args.listener);
    println!("  root-router      : {root_url}");
    println!("  east-router      : {east_url} -> {root_url}");
    println!("  alpha-client     : {}", fmt_addr(&alpha_addr));
    println!();

    // 1) Start two real router nodes using the selected listener backend.
    let root = Arc::new(RouterNode::new(
        RouterConfig::new("root-router", &root_addr)
            .with_tap(128)
            .with_listener_backend(args.listener),
    ));
    root.start().await.context("start root-router")?;

    let east = Arc::new(RouterNode::new(
        RouterConfig::new("east-router", &east_addr)
            .with_upstream(&root_url)
            .with_tap(128)
            .with_listener_backend(args.listener),
    ));
    east.start().await.context("start east-router")?;
    sleep(Duration::from_millis(700)).await;
    println!("[PASS] two routers started and east-router connected upstream");

    // 2) Connect alpha to east. This exercises Hello + LinkMessage::Announce.
    let alpha = connect_peer(
        &east_url,
        "alpha-client",
        "endpoint",
        &[alpha_addr.clone()],
        &[],
    )
    .await?;
    alpha
        .send_message(LinkMessage::Announce {
            address: alpha_addr.clone(),
            distance: 0,
        })
        .await?;
    sleep(Duration::from_millis(300)).await;
    println!("[PASS] alpha-client completed Hello and route announce to east-router");

    // east-router now re-announces newly learned downstream routes upstream.
    sleep(Duration::from_millis(700)).await;
    println!("[PASS] root-router learned alpha route via automatic upstream re-announce");

    // 3) Route a SessionEnvelope from root-side control peer to alpha via east.
    let control = connect_peer(
        &root_url,
        "control-client",
        "endpoint",
        &[control_addr.clone()],
        &[],
    )
    .await?;
    let routed = SessionEnvelope::new(
        control_addr.clone(),
        alpha_addr.clone(),
        "demo.routed_envelope",
        json!({"message": "root -> east -> alpha"}),
    );
    control
        .send_message(LinkMessage::Envelope(routed.clone()))
        .await?;
    let received = expect_envelope(&alpha, "alpha routed envelope").await?;
    assert_eq!(received.subtype, "demo.routed_envelope");
    assert_eq!(received.target, alpha_addr);
    assert!(received.route_hops.contains(&"root-router".to_string()));
    assert!(received.route_hops.contains(&"east-router".to_string()));
    println!("[PASS] routed envelope crossed root-router -> east-router -> alpha-client");

    // 4) Validate session_update and requestion.* as GV/router semantic events.
    // A root-side viewer endpoint receives upload fan-out via the weak
    // `surface_viewer` capability. The router does not know observer/control
    // user-layer roles.
    let observer = connect_peer(
        &root_url,
        "root-viewer",
        "endpoint",
        &[],
        &["surface_viewer"],
    )
    .await?;

    let session_update = SessionEnvelope::new(
        control_addr.clone(),
        alpha_addr.clone(),
        "session_update",
        json!({"state": "running", "title": "GV network validation"}),
    );
    control
        .send_message(LinkMessage::Envelope(session_update))
        .await?;
    let observed_update = expect_envelope(&observer, "viewer session_update upload").await?;
    assert_eq!(observed_update.link_type, "upload");
    assert_eq!(observed_update.subtype, "session_update");
    println!("[PASS] session_update upload fan-out reached surface_viewer endpoint");

    let requestion = SessionEnvelope::new(
        control_addr.clone(),
        alpha_addr.clone(),
        "requestion.asked",
        json!({"questionId": "rq-demo", "prompt": "continue?"}),
    );
    control
        .send_message(LinkMessage::Envelope(requestion))
        .await?;
    let observed_requestion = expect_envelope(&observer, "viewer requestion upload").await?;
    assert_eq!(observed_requestion.link_type, "upload");
    assert_eq!(observed_requestion.subtype, "requestion_asked");
    println!("[PASS] requestion upload fan-out reached surface_viewer endpoint");

    // 5) Validate ReadRequest forwarding and addressed ReadResponse return.
    let read_request = ReadRequest::new(
        control_addr.clone(),
        alpha_addr.clone(),
        ReadOperation::RuntimeSessionMessages {
            runtime_id: "runtime-alpha".into(),
            session_id: SessionId::new("session-alpha"),
            anchor_time: None,
            limit: Some(10),
            regex: None,
        },
    );
    control
        .send_message(LinkMessage::ReadRequest(read_request.clone()))
        .await?;
    let received_read = expect_read_request(&alpha, "alpha read request").await?;
    assert_eq!(received_read.request_id, read_request.request_id);
    assert_eq!(received_read.source, control_addr);
    assert_eq!(received_read.target, alpha_addr);

    let read_response = ReadResponse::ok_for_request(
        &alpha_addr,
        &received_read,
        json!({"messages": [], "count": 0, "_source": "gv-network-validation"}),
    );
    alpha
        .send_message(LinkMessage::ReadResponse(read_response.clone()))
        .await?;
    let received_response = expect_read_response(&control, "control read response").await?;
    assert_eq!(received_response.request_id, read_request.request_id);
    assert_eq!(received_response.source, alpha_addr);
    assert_eq!(received_response.target, control_addr);
    assert!(received_response.is_ok());
    println!("[PASS] ReadRequest and ReadResponse crossed routers using source/target addresses");

    // Also send a typed SessionUpdate to document current behavior: it is
    // observable on the local router, but typed envelope forwarding is still MVP
    // and is not used as the routed delivery assertion in this harness.
    let typed_id = osgp::Envelope::new(
        RouteTarget::address(control_addr),
        RouteTarget::address(alpha_addr),
        osgp::Payload::SessionUpdate(osgp::SessionUpdate {
            session_id: SessionId::new("session-alpha"),
            state: osgp::SessionState::Running,
            title: Some("typed session_update smoke".into()),
            summary: Some("typed envelope broadcast smoke only".into()),
            metadata: None,
        }),
    );
    control
        .send_message(LinkMessage::TypedEnvelope(typed_id))
        .await?;
    println!(
        "[INFO] typed SessionUpdate sent as smoke; routed typed delivery remains router MVP scope"
    );

    println!();
    println!("==============================================================");
    println!("  GV network validation complete: PASS");
    println!("==============================================================");
    Ok(())
}

async fn connect_peer(
    router_url: &str,
    node_id: &str,
    role: &str,
    addresses: &[SessionAddress],
    capabilities: &[&str],
) -> Result<WebSocketTransportHandle> {
    let transport = WebSocketTransportHandle::connect(router_url)
        .await
        .with_context(|| format!("connect {node_id} to {router_url}"))?;
    let role_json = match role {
        "endpoint" => json!("endpoint"),
        "router" => json!("router"),
        other => bail!("unsupported role {other}"),
    };
    let hello = json!({
        "nodeId": node_id,
        "role": role_json,
        "addresses": addresses,
        "capabilities": capabilities,
    });
    transport
        .send_raw_text(&serde_json::to_string(&hello)?)
        .await?;
    let reply = timeout(Duration::from_secs(2), transport.receive_raw_text())
        .await
        .with_context(|| format!("timeout waiting Hello reply for {node_id}"))??
        .with_context(|| format!("connection closed before Hello reply for {node_id}"))?;
    if !reply.contains("router") {
        bail!("unexpected Hello reply for {node_id}: {reply}");
    }
    Ok(transport)
}

async fn expect_envelope(
    transport: &WebSocketTransportHandle,
    label: &str,
) -> Result<SessionEnvelope> {
    let msg = timeout(Duration::from_secs(3), transport.receive_message())
        .await
        .with_context(|| format!("timeout waiting {label}"))??
        .with_context(|| format!("connection closed waiting {label}"))?;
    match msg {
        LinkMessage::Envelope(envelope) => Ok(envelope),
        other => bail!("expected envelope for {label}, got {other:?}"),
    }
}

async fn expect_read_request(
    transport: &WebSocketTransportHandle,
    label: &str,
) -> Result<ReadRequest> {
    let msg = timeout(Duration::from_secs(3), transport.receive_message())
        .await
        .with_context(|| format!("timeout waiting {label}"))??
        .with_context(|| format!("connection closed waiting {label}"))?;
    match msg {
        LinkMessage::ReadRequest(request) => Ok(request),
        other => bail!("expected ReadRequest for {label}, got {other:?}"),
    }
}

async fn expect_read_response(
    transport: &WebSocketTransportHandle,
    label: &str,
) -> Result<ReadResponse> {
    let msg = timeout(Duration::from_secs(3), transport.receive_message())
        .await
        .with_context(|| format!("timeout waiting {label}"))??
        .with_context(|| format!("connection closed waiting {label}"))?;
    match msg {
        LinkMessage::ReadResponse(response) => Ok(response),
        other => bail!("expected ReadResponse for {label}, got {other:?}"),
    }
}

fn fmt_addr(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(runtime), Some(session)) => format!("{}/{}/{}", addr.domain, runtime, session),
        (Some(runtime), None) => format!("{}/{}/*", addr.domain, runtime),
        (None, Some(session)) => format!("{}/*/{}", addr.domain, session),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

struct Args {
    base_port: u16,
    listener: ListenerBackend,
}

impl Args {
    fn parse() -> Result<Self> {
        let mut base_port = 7300u16;
        let mut listener = ListenerBackend::Default;
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--base-port" => {
                    base_port = args
                        .next()
                        .context("--base-port requires a value")?
                        .parse()
                        .context("invalid --base-port")?;
                }
                "--listener" => {
                    listener = match args
                        .next()
                        .context("--listener requires default|pingora")?
                        .as_str()
                    {
                        "default" => ListenerBackend::Default,
                        "pingora" => ListenerBackend::Pingora,
                        other => bail!("unsupported --listener {other}; use default|pingora"),
                    };
                }
                "--help" | "-h" => {
                    print_help();
                    std::process::exit(0);
                }
                other => bail!("unknown argument {other}; use --help"),
            }
        }
        Ok(Self {
            base_port,
            listener,
        })
    }
}

fn print_help() {
    println!("Usage: gv-network-validation [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --base-port <PORT>       Root router port; east uses PORT+1 [default: 7300]");
    println!("  --listener <BACKEND>     default|pingora [default: default]");
    println!("  -h, --help               Show this help");
}
