use anyhow::{ensure, Context, Result};
use glassvein_pingora::{spawn_pingora_ingress, PingoraIngressConfig};
use glassvein_protocol::{NodeRole, RouteAddress};
use glassvein_router::{run_demo_client, run_router, DemoClientConfig, RouterConfig};
use tokio::{
    sync::oneshot,
    time::{sleep, timeout, Duration},
};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info,glassvein_router=debug")
        .with_target(false)
        .init();

    start_router("root-a", "127.0.0.1:7400", vec![]);
    start_router("root-b", "127.0.0.1:7401", vec![]);
    sleep(Duration::from_millis(200)).await;

    let _pingora = spawn_pingora_ingress(vec![
        ingress("root-a-ingress", "127.0.0.1:7410", vec!["127.0.0.1:7400"]),
        ingress("root-b-ingress", "127.0.0.1:7411", vec!["127.0.0.1:7401"]),
        ingress("dual-ingress", "127.0.0.1:7412", vec!["127.0.0.1:7402"]),
    ])?;
    sleep(Duration::from_millis(500)).await;

    // This is the node under test: two upstreams and several downstreams.
    start_router(
        "dual-router",
        "127.0.0.1:7402",
        vec!["ws://127.0.0.1:7410", "ws://127.0.0.1:7411"],
    );
    sleep(Duration::from_millis(500)).await;

    let a_client = addr("runtime-a", "session-a");
    let b_client = addr("runtime-b", "session-b");
    let dual_client = addr("runtime-dual", "session-dual");
    let dual_surface = addr("surface-dual", "surface-main");

    start_responder(
        "a-client",
        NodeRole::Client,
        "ws://127.0.0.1:7410",
        a_client.clone(),
    );
    start_responder(
        "b-client",
        NodeRole::Client,
        "ws://127.0.0.1:7411",
        b_client.clone(),
    );
    start_responder(
        "dual-client",
        NodeRole::Client,
        "ws://127.0.0.1:7412",
        dual_client.clone(),
    );
    start_responder(
        "dual-surface",
        NodeRole::Surface,
        "ws://127.0.0.1:7412",
        dual_surface.clone(),
    );

    // Let bidirectional route updates converge across both upstreams.
    sleep(Duration::from_millis(1200)).await;

    probe(
        "dual-to-root-a",
        "ws://127.0.0.1:7412",
        a_client,
        &["dual-router", "root-a"],
        &["root-a", "dual-router"],
    )
    .await?;

    probe(
        "dual-to-root-b",
        "ws://127.0.0.1:7412",
        b_client.clone(),
        &["dual-router", "root-b"],
        &["root-b", "dual-router"],
    )
    .await?;

    probe(
        "root-a-to-root-b-via-dual",
        "ws://127.0.0.1:7410",
        b_client,
        &["root-a", "dual-router", "root-b"],
        &["root-b", "dual-router", "root-a"],
    )
    .await?;

    probe(
        "dual-local-surface",
        "ws://127.0.0.1:7412",
        dual_surface,
        &["dual-router"],
        &["dual-router"],
    )
    .await?;

    println!("GlassVein multi-upstream demo OK: dual-router chose both upstreams and served local downstreams");
    Ok(())
}

fn ingress(name: &str, listen_addr: &str, upstreams: Vec<&str>) -> PingoraIngressConfig {
    PingoraIngressConfig {
        name: name.to_string(),
        listen_addr: listen_addr.to_string(),
        upstreams: upstreams.into_iter().map(str::to_string).collect(),
    }
}

fn addr(runtime_id: &str, session_id: &str) -> RouteAddress {
    RouteAddress::new("domain-a", Some(runtime_id), Some(session_id))
}

fn start_router(node_id: &str, bind_addr: &str, upstream_urls: Vec<&str>) {
    let config = RouterConfig {
        node_id: node_id.to_string(),
        bind_addr: bind_addr.to_string(),
        upstream_urls: upstream_urls.into_iter().map(str::to_string).collect(),
        announce_routes: vec![],
    };
    tokio::spawn(async move {
        if let Err(error) = run_router(config).await {
            eprintln!("router stopped: {error:?}");
        }
    });
}

fn start_responder(node_id: &str, role: NodeRole, router_url: &str, route: RouteAddress) {
    let config = DemoClientConfig {
        node_id: node_id.to_string(),
        role,
        router_url: router_url.to_string(),
        route,
        auto_reply: true,
        initial_target: None,
    };
    tokio::spawn(async move {
        if let Err(error) = run_demo_client(config, None).await {
            eprintln!("responder stopped: {error:?}");
        }
    });
}

async fn probe(
    label: &str,
    router_url: &str,
    target: RouteAddress,
    expected_request_hops: &[&str],
    expected_reply_hops: &[&str],
) -> Result<()> {
    let source = addr(
        &format!("runtime-probe-{label}"),
        &format!("session-probe-{label}"),
    );
    let (done_tx, done_rx) = oneshot::channel();
    let config = DemoClientConfig {
        node_id: format!("probe-{label}"),
        role: NodeRole::Panel,
        router_url: router_url.to_string(),
        route: source,
        auto_reply: false,
        initial_target: Some(target),
    };

    tokio::spawn(async move {
        if let Err(error) = run_demo_client(config, Some(done_tx)).await {
            eprintln!("probe stopped: {error:?}");
        }
    });

    let reply = timeout(Duration::from_secs(10), done_rx)
        .await
        .with_context(|| format!("{label}: timed out waiting for reply"))??;

    let request_hops = reply
        .payload
        .get("receivedRouteHops")
        .and_then(|value| value.as_array())
        .context("reply did not include receivedRouteHops")?
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();

    let expected_request_hops = expected_request_hops
        .iter()
        .map(|hop| hop.to_string())
        .collect::<Vec<_>>();
    let expected_reply_hops = expected_reply_hops
        .iter()
        .map(|hop| hop.to_string())
        .collect::<Vec<_>>();

    ensure!(
        request_hops == expected_request_hops,
        "{label}: request hops mismatch: got {request_hops:?}, expected {expected_request_hops:?}"
    );
    ensure!(
        reply.route_hops == expected_reply_hops,
        "{label}: reply hops mismatch: got {:?}, expected {:?}",
        reply.route_hops,
        expected_reply_hops
    );

    info!(%label, request_hops = ?request_hops, reply_hops = ?reply.route_hops, "multi-upstream probe passed");
    Ok(())
}
