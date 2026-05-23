//! Router configuration.

use osgp::SessionAddress;

/// Downstream listener backend selected at router runtime.
///
/// The default remains the existing tokio + tokio-tungstenite listener even
/// when optional Pingora code is compiled. Selecting [`ListenerBackend::Pingora`]
/// requires the `pingora-listener` feature; without it, startup fails clearly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ListenerBackend {
    /// Existing tokio `TcpListener` + tokio-tungstenite WebSocket path.
    #[default]
    Default,
    /// Pingora server/listener path backed by core `PingoraTransport`.
    Pingora,
}

/// Configuration for a GlassVein router node.
#[derive(Debug, Clone)]
pub struct RouterConfig {
    pub node_id: String,
    /// Address to bind the downstream listener (e.g., `"127.0.0.1:7100"`).
    pub bind_addr: String,
    /// Upstream (parent) router URLs (0 or more in tree topology).
    pub upstream_urls: Vec<String>,
    /// Addresses to announce to upstream during Hello.
    pub announce_routes: Vec<SessionAddress>,
    /// Capacity of the tap broadcast channel. `None` = tap disabled.
    pub tap_capacity: Option<usize>,
    /// Runtime-selected downstream listener backend.
    pub listener_backend: ListenerBackend,
}

impl RouterConfig {
    pub fn new(node_id: impl Into<String>, bind_addr: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
            bind_addr: bind_addr.into(),
            upstream_urls: Vec::new(),
            announce_routes: Vec::new(),
            tap_capacity: None,
            listener_backend: ListenerBackend::Default,
        }
    }

    pub fn with_upstream(mut self, url: impl Into<String>) -> Self {
        self.upstream_urls.push(url.into());
        self
    }

    pub fn with_tap(mut self, capacity: usize) -> Self {
        self.tap_capacity = Some(capacity);
        self
    }

    pub fn with_announce_routes(mut self, routes: Vec<SessionAddress>) -> Self {
        self.announce_routes = routes;
        self
    }

    pub fn with_listener_backend(mut self, backend: ListenerBackend) -> Self {
        self.listener_backend = backend;
        self
    }
}
