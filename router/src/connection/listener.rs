//! WebSocket listener for downstream connections.

use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::net::TcpListener;
use tracing::{info, warn};

use super::config::ListenerConfig;
use super::ConnectionManager;

impl ConnectionManager {
    /// Start the WebSocket listener for downstream connections.
    ///
    /// Binds to `config.bind_addr` and accepts incoming WebSocket connections.
    /// For each connection:
    /// 1. Performs Hello handshake to learn peer's node_id and role
    /// 2. Registers the peer in the peer registry
    /// 3. Spawns a message processing loop
    /// 4. On disconnect, unregisters the peer and cleans up routes
    ///
    /// Returns the `TcpListener` bound address (useful when binding to `:0`).
    pub async fn start_listener(self: &Arc<Self>, config: &ListenerConfig) -> Result<String> {
        let listener = TcpListener::bind(&config.bind_addr)
            .await
            .with_context(|| format!("bind listener at {}", config.bind_addr))?;

        let local_addr = listener
            .local_addr()
            .map(|a| a.to_string())
            .unwrap_or_else(|_| config.bind_addr.clone());

        info!(node_id = %self.node_id, addr = %local_addr, "listener started");

        let mgr = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let (stream, peer_addr) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(e) => {
                        warn!(node_id = %mgr.node_id, error = %e, "accept failed");
                        continue;
                    }
                };

                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    if let Err(e) = mgr
                        .handle_incoming_connection(stream, peer_addr.to_string())
                        .await
                    {
                        warn!(node_id = %mgr.node_id, peer = %peer_addr, error = %e, "connection failed");
                    }
                });
            }
        });

        Ok(local_addr)
    }
}
