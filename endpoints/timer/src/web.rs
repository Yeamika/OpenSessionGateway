//! HTTP server and routing for the Timer endpoint.
//!
//! Routes:
//! - `POST /mcp/timer_scheduler?runtimeID=...` — self-scope MCP
//! - `POST /mcp/timer_manager` — manager-scope MCP
//! - `GET /api/status` — health check

use anyhow::Result;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;

use crate::gv_client::GvClient;
use crate::mcp_api::{McpApi, McpScope};
use crate::timer_store::TimerStore;

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub mcp: McpApi,
    pub store: TimerStore,
    pub gv: GvClient,
    pub domain: String,
    pub runtime_id: String,
    pub session_id: String,
}

/// Query parameters for `/mcp/timer_scheduler`.
#[derive(Deserialize)]
pub struct SchedulerQuery {
    #[serde(rename = "runtimeID")]
    pub runtime_id: Option<String>,
}

/// Start the HTTP server. Runs until shutdown signal.
pub async fn run_server(addr: SocketAddr, state: AppState) -> Result<()> {
    let app = create_router(state);
    tracing::info!(%addr, "HTTP server listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/mcp/timer_scheduler", post(handle_scheduler))
        .route("/mcp/timer_manager", post(handle_manager))
        .route("/api/status", get(handle_status))
        .with_state(Arc::new(state))
}

/// POST /mcp/timer_scheduler?runtimeID=...
async fn handle_scheduler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SchedulerQuery>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let runtime_id = query.runtime_id.unwrap_or_else(|| state.runtime_id.clone());
    let resp = state
        .mcp
        .handle_request(McpScope::Self_, &runtime_id, body)
        .await;
    Json(resp)
}

/// POST /mcp/timer_manager
async fn handle_manager(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let resp = state
        .mcp
        .handle_request(McpScope::Manager, &state.runtime_id, body)
        .await;
    Json(resp)
}

/// GET /api/status
async fn handle_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let gv_state = state.gv.state();
    let pending = state.store.pending_count().await;
    Json(json!({
        "ok": true,
        "domain": state.domain,
        "runtime_id": state.runtime_id,
        "session_id": state.session_id,
        "gv_connection": format!("{:?}", gv_state),
        "pending_timers": pending,
    }))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
