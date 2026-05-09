use anyhow::{ensure, Context, Result};
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

    start_router("root-router", "127.0.0.1:7200", vec![]);
    sleep(Duration::from_millis(150)).await;

    start_router("east-router", "127.0.0.1:7201", vec!["ws://127.0.0.1:7200"]);
    start_router("west-router", "127.0.0.1:7202", vec!["ws://127.0.0.1:7200"]);
    sleep(Duration::from_millis(200)).await;

    start_router(
        "nested-router",
        "127.0.0.1:7203",
        vec!["ws://127.0.0.1:7202"],
    );
    sleep(Duration::from_millis(300)).await;

    let alpha = addr("runtime-alpha", "session-alpha");
    let beta = addr("runtime-beta", "session-beta");
    let gamma = addr("runtime-gamma", "session-gamma");
    let control_surface = addr("surface-runtime-control", "surface-main");

    start_responder(
        "alpha-client",
        NodeRole::Client,
        "ws://127.0.0.1:7201",
        alpha.clone(),
    );
    start_responder(
        "beta-client",
        NodeRole::Client,
        "ws://127.0.0.1:7202",
        beta.clone(),
    );
    start_responder(
        "gamma-client",
        NodeRole::Client,
        "ws://127.0.0.1:7203",
        gamma,
    );
    start_responder(
        "runtime-control-surface",
        NodeRole::Surface,
        "ws://127.0.0.1:7201",
        control_surface.clone(),
    );

    // Let dynamic route announcements propagate upward through the tree.
    sleep(Duration::from_millis(800)).await;

    probe(
        "east-local-client",
        "ws://127.0.0.1:7201",
        alpha,
        &["east-router"],
        &["east-router"],
    )
    .await?;

    probe(
        "east-to-west-client",
        "ws://127.0.0.1:7201",
        beta.clone(),
        &["east-router", "root-router", "west-router"],
        &["west-router", "root-router", "east-router"],
    )
    .await?;

    probe(
        "nested-to-west-client",
        "ws://127.0.0.1:7203",
        beta,
        &["nested-router", "west-router"],
        &["west-router", "nested-router"],
    )
    .await?;

    probe(
        "west-to-surface",
        "ws://127.0.0.1:7202",
        control_surface,
        &["west-router", "root-router", "east-router"],
        &["east-router", "root-router", "west-router"],
    )
    .await?;

    println!("GlassVein surface demo OK: all shortest-path probes passed");
    Ok(())
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

    let reply = timeout(Duration::from_secs(8), done_rx)
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

    info!(%label, request_hops = ?request_hops, reply_hops = ?reply.route_hops, "shortest-path probe passed");
    Ok(())
}
