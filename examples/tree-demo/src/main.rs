use anyhow::{Context, Result};
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

    let panel = RouteAddress::new("domain-a", Some("runtime-panel"), Some("session-panel"));
    let leaf = RouteAddress::new("domain-a", Some("runtime-leaf"), Some("session-leaf"));

    tokio::spawn(run_router(RouterConfig {
        node_id: "root-router".into(),
        bind_addr: "127.0.0.1:7100".into(),
        upstream_urls: vec![],
        announce_routes: vec![],
    }));
    sleep(Duration::from_millis(150)).await;

    tokio::spawn(run_router(RouterConfig {
        node_id: "child-router".into(),
        bind_addr: "127.0.0.1:7101".into(),
        upstream_urls: vec!["ws://127.0.0.1:7100".into()],
        announce_routes: vec![],
    }));
    sleep(Duration::from_millis(300)).await;

    tokio::spawn(run_demo_client(
        DemoClientConfig {
            node_id: "leaf-client".into(),
            role: NodeRole::Client,
            router_url: "ws://127.0.0.1:7101".into(),
            route: leaf.clone(),
            auto_reply: true,
            initial_target: None,
        },
        None,
    ));

    let (done_tx, done_rx) = oneshot::channel();
    tokio::spawn(run_demo_client(
        DemoClientConfig {
            node_id: "panel-client".into(),
            role: NodeRole::Panel,
            router_url: "ws://127.0.0.1:7100".into(),
            route: panel,
            auto_reply: false,
            initial_target: Some(leaf),
        },
        Some(done_tx),
    ));

    let reply = timeout(Duration::from_secs(5), done_rx)
        .await
        .context("demo timed out waiting for panel reply")??;

    info!(message_id = %reply.message_id, payload = %reply.payload, "tree demo completed: panel received reply");
    println!(
        "GlassVein tree demo OK: panel received {} from {}",
        reply.kind,
        reply.source.key()
    );
    Ok(())
}
