//! Configuration types for connection management.

use osgp::SessionAddress;

/// Configuration for the WebSocket listener.
#[derive(Debug, Clone)]
pub struct ListenerConfig {
    /// Address to bind the listener (e.g., `"127.0.0.1:7100"`).
    pub bind_addr: String,
}

/// Configuration for the upstream (parent) connection.
#[derive(Debug, Clone)]
pub struct UpstreamConfig {
    /// WebSocket URL of the parent router (e.g., `"ws://127.0.0.1:7100"`).
    pub url: String,
    /// Addresses this node announces to the upstream during Hello.
    pub announce_routes: Vec<SessionAddress>,
}
