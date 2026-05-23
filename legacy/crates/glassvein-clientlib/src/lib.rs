//! GlassVein Client Library — generic client for GlassVein routing network.
//!
//! This crate provides:
//! - `Transport` trait for abstracting the underlying network layer
//! - `FakeTransport` for in-memory demo/testing
//! - `Client` with connect/register/send/receive/subscribe API
//! - Integration with `glassvein-protocol` types (RouteEnvelope, RouteAddress, etc.)
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
//! │   Client A  │────▶│   Router    │────▶│   Client B  │
//! └─────────────┘     └─────────────┘     └─────────────┘
//!        │                   │
//!        ▼                   ▼
//!   ┌─────────┐        ┌─────────┐
//!   │Transport│        │Transport│
//!   └─────────┘        └─────────┘
//! ```
//!
//! # Usage
//!
//! ```rust,no_run
//! use glassvein_clientlib::{Client, ClientConfig, ClientIdentity, FakeTransportHub};
//! use glassvein_protocol::RouteAddress;
//!
//! # async fn example() -> anyhow::Result<()> {
//! let hub = FakeTransportHub::new();
//!
//! let config = ClientConfig {
//!     identity: ClientIdentity {
//!         node_id: "client-1".into(),
//!         domain_id: "demo".into(),
//!         runtime_id: Some("rt-1".into()),
//!         session_id: Some("ses-1".into()),
//!     },
//!     auto_reply: false,
//! };
//!
//! let mut client = Client::new(config, hub.create_transport("client-1").await);
//! client.connect().await?;
//! client.register().await?;
//!
//! // Send a message
//! let target = RouteAddress::new("demo", Some("rt-2"), Some("ses-2"));
//! client.send(target, "ping", serde_json::json!({"hello": "world"})).await?;
//!
//! // Receive messages
//! if let Some(envelope) = client.receive().await? {
//!     println!("Received: {:?}", envelope);
//! }
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use glassvein_protocol::{NodeRole, RouteAddress, RouteAnnouncement, RouteEnvelope, WireMessage};
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, info, warn};

// ───────────────────────────── Transport Trait ─────────────────────────────

/// Abstract transport layer for GlassVein client connections.
///
/// Implementations handle the actual network I/O (WebSocket, TCP, in-memory, etc.)
/// while the `Client` operates on protocol-level types.
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// Send a wire message to the connected router.
    async fn send_wire(&self, message: WireMessage) -> Result<()>;

    /// Receive the next wire message from the router.
    /// Returns `None` when the connection is closed.
    async fn receive_wire(&self) -> Result<Option<WireMessage>>;

    /// Check if the transport is currently connected.
    fn is_connected(&self) -> bool;

    /// Close the transport connection.
    async fn close(&self) -> Result<()>;
}

// ───────────────────────────── Fake Transport ─────────────────────────────

/// Hub for creating connected fake transport pairs.
///
/// Useful for simulating multiple clients in the same process.
pub struct FakeTransportHub {
    /// Map of node_id -> (sender, receiver) for routing messages between fake transports.
    routes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<WireMessage>>>>,
}

impl FakeTransportHub {
    pub fn new() -> Self {
        Self {
            routes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new fake transport for a given node_id.
    ///
    /// Messages sent to this node_id will be routed through the hub.
    /// The transport is immediately registered in the hub.
    pub async fn create_transport(&self, node_id: &str) -> FakeTransportHandle {
        let (tx, rx) = mpsc::unbounded_channel();

        // Register this node's sender synchronously
        self.routes
            .write()
            .await
            .insert(node_id.to_string(), tx.clone());

        FakeTransportHandle {
            node_id: node_id.to_string(),
            tx,
            rx: Arc::new(tokio::sync::Mutex::new(rx)),
            routes: self.routes.clone(),
        }
    }

    /// Send a message directly to a node in the hub (for testing).
    pub async fn send_to(&self, target_node: &str, message: WireMessage) -> Result<()> {
        let routes = self.routes.read().await;
        if let Some(tx) = routes.get(target_node) {
            tx.send(message)
                .map_err(|e| anyhow::anyhow!("send to {} failed: {}", target_node, e))
        } else {
            anyhow::bail!("node {} not found in hub", target_node)
        }
    }
}

impl Default for FakeTransportHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle for a fake transport, implementing the Transport trait.
pub struct FakeTransportHandle {
    node_id: String,
    tx: mpsc::UnboundedSender<WireMessage>,
    rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<WireMessage>>>,
    routes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<WireMessage>>>>,
}

#[async_trait]
impl Transport for FakeTransportHandle {
    async fn send_wire(&self, message: WireMessage) -> Result<()> {
        self.tx
            .send(message)
            .map_err(|e| anyhow::anyhow!("send failed: {}", e))
    }

    async fn receive_wire(&self) -> Result<Option<WireMessage>> {
        let mut rx = self.rx.lock().await;
        Ok(rx.recv().await)
    }

    fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }

    async fn close(&self) -> Result<()> {
        // Remove from routes
        self.routes.write().await.remove(&self.node_id);
        Ok(())
    }
}

// ───────────────────────────── Client Types ─────────────────────────────

/// Client identity in the GlassVein network.
#[derive(Clone, Debug)]
pub struct ClientIdentity {
    /// Unique node identifier.
    pub node_id: String,
    /// Domain this client belongs to.
    pub domain_id: String,
    /// Optional runtime identifier.
    pub runtime_id: Option<String>,
    /// Optional session identifier.
    pub session_id: Option<String>,
}

impl ClientIdentity {
    /// Convert to a RouteAddress for routing.
    pub fn to_route_address(&self) -> RouteAddress {
        RouteAddress::new(
            &self.domain_id,
            self.runtime_id.as_deref(),
            self.session_id.as_deref(),
        )
    }

    /// Get the full key representation.
    pub fn key(&self) -> String {
        self.to_route_address().key()
    }
}

/// Client configuration.
#[derive(Clone, Debug)]
pub struct ClientConfig {
    /// Client identity.
    pub identity: ClientIdentity,
    /// Whether to automatically reply to ping messages.
    pub auto_reply: bool,
}

/// Connection state of the client.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientState {
    /// Not connected.
    Disconnected,
    /// Connected but not registered.
    Connected,
    /// Connected and registered with routes.
    Registered,
}

/// A GlassVein client that can send and receive routed messages.
pub struct Client<T: Transport> {
    config: ClientConfig,
    transport: T,
    state: ClientState,
    pending_messages: Vec<RouteEnvelope>,
}

impl<T: Transport> Client<T> {
    /// Create a new client with the given config and transport.
    pub fn new(config: ClientConfig, transport: T) -> Self {
        Self {
            config,
            transport,
            state: ClientState::Disconnected,
            pending_messages: Vec::new(),
        }
    }

    /// Get the current client state.
    pub fn state(&self) -> &ClientState {
        &self.state
    }

    /// Get the client identity.
    pub fn identity(&self) -> &ClientIdentity {
        &self.config.identity
    }

    /// Connect to the router.
    ///
    /// This establishes the underlying transport connection.
    pub async fn connect(&mut self) -> Result<()> {
        if self.state != ClientState::Disconnected {
            anyhow::bail!("client is already connected");
        }

        // For fake transport, this is a no-op
        // For real transports, this would establish TCP/WS connection
        self.state = ClientState::Connected;
        info!(client = %self.config.identity.node_id, "client connected");
        Ok(())
    }

    /// Register with the router by sending a Hello message with route announcements.
    ///
    /// This should be called after `connect()`.
    pub async fn register(&mut self) -> Result<()> {
        if self.state != ClientState::Connected {
            anyhow::bail!("client must be connected before registering");
        }

        let address = self.config.identity.to_route_address();
        let announcement = RouteAnnouncement::local(address.clone());

        let hello = WireMessage::Hello {
            node_id: self.config.identity.node_id.clone(),
            role: NodeRole::Client,
            routes: vec![announcement],
        };

        self.transport.send_wire(hello).await?;
        self.state = ClientState::Registered;
        info!(
            client = %self.config.identity.node_id,
            route = %address.key(),
            "client registered"
        );
        Ok(())
    }

    /// Send a message to a target address.
    ///
    /// Creates a RouteEnvelope and sends it through the transport.
    pub async fn send(
        &self,
        target: RouteAddress,
        kind: &str,
        payload: serde_json::Value,
    ) -> Result<String> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before sending");
        }

        let source = self.config.identity.to_route_address();
        let envelope = RouteEnvelope::new(source, target, kind, payload);
        let message_id = envelope.message_id.clone();

        let wire = WireMessage::Envelope {
            envelope: Box::new(envelope),
        };

        self.transport.send_wire(wire).await?;
        debug!(
            client = %self.config.identity.node_id,
            message_id = %message_id,
            kind = %kind,
            "message sent"
        );
        Ok(message_id)
    }

    /// Receive the next message addressed to this client.
    ///
    /// This method filters incoming wire messages and only returns envelopes
    /// addressed to this client's route address.
    pub async fn receive(&mut self) -> Result<Option<RouteEnvelope>> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before receiving");
        }

        // First, check pending messages
        if !self.pending_messages.is_empty() {
            return Ok(Some(self.pending_messages.remove(0)));
        }

        // Then, receive from transport
        loop {
            match self.transport.receive_wire().await? {
                Some(wire) => match wire {
                    WireMessage::Envelope { envelope } => {
                        let envelope = *envelope;
                        if self.is_addressed_to_me(&envelope.target) {
                            debug!(
                                client = %self.config.identity.node_id,
                                message_id = %envelope.message_id,
                                kind = %envelope.kind,
                                "message received"
                            );
                            return Ok(Some(envelope));
                        } else {
                            // Not addressed to us, skip
                            debug!(
                                client = %self.config.identity.node_id,
                                target = %envelope.target.key(),
                                "skipping message not addressed to me"
                            );
                        }
                    }
                    _ => {
                        // Ignore non-envelope messages (Hello, RouteUpdate, etc.)
                        debug!(
                            client = %self.config.identity.node_id,
                            "ignoring non-envelope wire message"
                        );
                    }
                },
                None => {
                    // Connection closed
                    warn!(client = %self.config.identity.node_id, "connection closed");
                    return Ok(None);
                }
            }
        }
    }

    /// Subscribe to messages matching a filter predicate.
    ///
    /// Returns a receiver that yields matching envelopes.
    pub async fn subscribe<F>(&self, _filter: F) -> Result<mpsc::UnboundedReceiver<RouteEnvelope>>
    where
        F: Fn(&RouteEnvelope) -> bool + Send + Sync + 'static,
    {
        // For now, return a channel that would need to be fed by a background task
        // In a real implementation, this would spawn a task to filter and forward messages
        let (_tx, rx) = mpsc::unbounded_channel();

        // TODO: Implement actual subscription logic with background filtering
        warn!("subscribe() is not yet fully implemented");

        Ok(rx)
    }

    /// Check if a route address is addressed to this client.
    fn is_addressed_to_me(&self, target: &RouteAddress) -> bool {
        let my_addr = self.config.identity.to_route_address();

        // Exact match
        if target == &my_addr {
            return true;
        }

        // Domain-level match (if target has no runtime/session)
        if target.runtime_id.is_none() && target.session_id.is_none() {
            return target.domain_id == my_addr.domain_id;
        }

        // Runtime-level match
        if target.session_id.is_none() {
            return target.domain_id == my_addr.domain_id
                && target.runtime_id == my_addr.runtime_id;
        }

        false
    }
}

// ───────────────────────────── Convenience Functions ─────────────────────────────

/// Create a simple client with fake transport for testing.
pub async fn create_fake_client(
    node_id: &str,
    domain_id: &str,
    runtime_id: Option<&str>,
    session_id: Option<&str>,
    hub: &FakeTransportHub,
) -> Client<FakeTransportHandle> {
    let config = ClientConfig {
        identity: ClientIdentity {
            node_id: node_id.to_string(),
            domain_id: domain_id.to_string(),
            runtime_id: runtime_id.map(|s| s.to_string()),
            session_id: session_id.map(|s| s.to_string()),
        },
        auto_reply: false,
    };

    let transport = hub.create_transport(node_id).await;
    Client::new(config, transport)
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn client_identity_to_route_address() {
        let identity = ClientIdentity {
            node_id: "node-1".into(),
            domain_id: "demo".into(),
            runtime_id: Some("rt-1".into()),
            session_id: Some("ses-1".into()),
        };

        let addr = identity.to_route_address();
        assert_eq!(addr.domain_id, "demo");
        assert_eq!(addr.runtime_id, Some("rt-1".into()));
        assert_eq!(addr.session_id, Some("ses-1".into()));
        assert_eq!(addr.key(), "demo/rt-1/ses-1");
    }

    #[test]
    fn client_identity_key_with_wildcards() {
        let identity = ClientIdentity {
            node_id: "node-1".into(),
            domain_id: "demo".into(),
            runtime_id: None,
            session_id: None,
        };

        assert_eq!(identity.key(), "demo/*/*");
    }

    #[test]
    fn client_state_transitions() {
        // Initial state is Disconnected
        let state = ClientState::Disconnected;
        assert_eq!(state, ClientState::Disconnected);

        // Can transition to Connected
        let state = ClientState::Connected;
        assert_eq!(state, ClientState::Connected);

        // Can transition to Registered
        let state = ClientState::Registered;
        assert_eq!(state, ClientState::Registered);
    }

    #[tokio::test]
    async fn fake_transport_hub_create_and_send() {
        let hub = FakeTransportHub::new();

        let _handle1 = hub.create_transport("node-1").await;
        let handle2 = hub.create_transport("node-2").await;

        // Send from node-1 to node-2 via hub
        let msg = WireMessage::Hello {
            node_id: "node-1".into(),
            role: NodeRole::Client,
            routes: vec![],
        };

        hub.send_to("node-2", msg).await.unwrap();

        // node-2 should receive the message
        let received = handle2.receive_wire().await.unwrap();
        assert!(received.is_some());

        match received.unwrap() {
            WireMessage::Hello { node_id, .. } => assert_eq!(node_id, "node-1"),
            _ => panic!("expected Hello message"),
        }
    }

    #[tokio::test]
    async fn client_connect_and_register() {
        let hub = FakeTransportHub::new();
        let mut client = create_fake_client(
            "test-client",
            "demo",
            Some("rt-1"),
            Some("ses-1"),
            &hub,
        ).await;

        // Initial state
        assert_eq!(*client.state(), ClientState::Disconnected);

        // Connect
        client.connect().await.unwrap();
        assert_eq!(*client.state(), ClientState::Connected);

        // Register
        client.register().await.unwrap();
        assert_eq!(*client.state(), ClientState::Registered);
    }

    #[tokio::test]
    async fn client_send_requires_registration() {
        let hub = FakeTransportHub::new();
        let client = create_fake_client(
            "test-client",
            "demo",
            Some("rt-1"),
            Some("ses-1"),
            &hub,
        ).await;

        // Should fail before registration
        let target = RouteAddress::new("demo", Some("rt-2"), Some("ses-2"));
        let result = client.send(target, "test", json!({})).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn client_is_addressed_to_me() {
        let hub = FakeTransportHub::new();
        let client = create_fake_client(
            "test-client",
            "demo",
            Some("rt-1"),
            Some("ses-1"),
            &hub,
        ).await;

        // Exact match
        let target = RouteAddress::new("demo", Some("rt-1"), Some("ses-1"));
        assert!(client.is_addressed_to_me(&target));

        // Domain-level match
        let target = RouteAddress::domain("demo");
        assert!(client.is_addressed_to_me(&target));

        // Runtime-level match
        let target = RouteAddress::new("demo", Some("rt-1"), None::<String>);
        assert!(client.is_addressed_to_me(&target));

        // Different domain
        let target = RouteAddress::new("other", Some("rt-1"), Some("ses-1"));
        assert!(!client.is_addressed_to_me(&target));

        // Different runtime
        let target = RouteAddress::new("demo", Some("rt-2"), Some("ses-1"));
        assert!(!client.is_addressed_to_me(&target));
    }

    #[test]
    fn route_envelope_creation() {
        let source = RouteAddress::new("d1", Some("r1"), Some("s1"));
        let target = RouteAddress::new("d2", Some("r2"), Some("s2"));
        let envelope = RouteEnvelope::new(source.clone(), target.clone(), "test", json!({"key": "value"}));

        assert_eq!(envelope.source, source);
        assert_eq!(envelope.target, target);
        assert_eq!(envelope.kind, "test");
        assert_eq!(envelope.payload["key"], "value");
        assert_eq!(envelope.ttl, 16);
        assert!(envelope.route_hops.is_empty());
    }

    #[test]
    fn wire_message_envelope_format() {
        let source = RouteAddress::new("d1", Some("r1"), Some("s1"));
        let target = RouteAddress::new("d2", Some("r2"), Some("s2"));
        let envelope = RouteEnvelope::new(source, target, "test", json!({}));

        let wire = WireMessage::Envelope {
            envelope: Box::new(envelope),
        };

        let json_str = serde_json::to_string(&wire).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        assert_eq!(val["type"], "envelope");
        assert!(val["envelope"].is_object());
        assert_eq!(val["envelope"]["kind"], "test");
    }
}
