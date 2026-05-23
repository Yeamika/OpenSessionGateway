//! Client types: identity, configuration, state, and the main Client struct.

use anyhow::Result;
use osgp::{Envelope, LinkMessage, Payload, RouteTarget, SessionAddress, SessionEnvelope};
use tracing::{debug, info, warn};

use super::transport::Transport;

/// Client identity in the OSGP network.
#[derive(Clone, Debug)]
pub struct ClientIdentity {
    /// Unique node identifier.
    pub node_id: String,
    /// Session address for routing.
    pub address: SessionAddress,
}

impl ClientIdentity {
    /// Convert to a RouteTarget for routing.
    pub fn to_route_target(&self) -> RouteTarget {
        RouteTarget::address(self.address.clone())
    }

    /// Get the node ID.
    pub fn node_id(&self) -> &str {
        &self.node_id
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

/// An OSGP client that can send and receive routed messages.
pub struct Client<T: Transport> {
    config: ClientConfig,
    transport: T,
    state: ClientState,
    pending_messages: Vec<Envelope>,
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
    pub async fn connect(&mut self) -> Result<()> {
        if self.state != ClientState::Disconnected {
            anyhow::bail!("client is already connected");
        }

        self.state = ClientState::Connected;
        info!(client = %self.config.identity.node_id, "client connected");
        Ok(())
    }

    /// Register with the router by sending an Announce message.
    pub async fn register(&mut self) -> Result<()> {
        if self.state != ClientState::Connected {
            anyhow::bail!("client must be connected before registering");
        }

        let address = self.config.identity.address.clone();
        let announce = LinkMessage::Announce {
            address: address.clone(),
            distance: 0,
        };

        self.transport.send_message(announce).await?;
        self.state = ClientState::Registered;
        info!(
            client = %self.config.identity.node_id,
            domain = %address.domain,
            runtime = ?address.runtime,
            session = ?address.session,
            "client registered"
        );
        Ok(())
    }

    /// Send a typed envelope to a target.
    pub async fn send(&self, target: RouteTarget, payload: Payload) -> Result<String> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before sending");
        }

        let source = self.config.identity.to_route_target();
        let envelope = Envelope::new(source, target, payload);
        let message_id = envelope.message_id.clone();

        let wire = LinkMessage::TypedEnvelope(envelope);
        self.transport.send_message(wire).await?;
        debug!(
            client = %self.config.identity.node_id,
            message_id = %message_id,
            "message sent"
        );
        Ok(message_id)
    }

    /// Send a legacy session envelope to a target.
    pub async fn send_legacy(&self, envelope: SessionEnvelope) -> Result<()> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before sending");
        }

        let wire = LinkMessage::Envelope(envelope);
        self.transport.send_message(wire).await?;
        debug!(
            client = %self.config.identity.node_id,
            "legacy message sent"
        );
        Ok(())
    }

    /// Receive the next typed envelope addressed to this client.
    pub async fn receive(&mut self) -> Result<Option<Envelope>> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before receiving");
        }

        if !self.pending_messages.is_empty() {
            return Ok(Some(self.pending_messages.remove(0)));
        }

        loop {
            match self.transport.receive_message().await? {
                Some(message) => match message {
                    LinkMessage::TypedEnvelope(envelope) => {
                        debug!(
                            client = %self.config.identity.node_id,
                            message_id = %envelope.message_id,
                            "typed envelope received"
                        );
                        return Ok(Some(envelope));
                    }
                    LinkMessage::Envelope(_legacy) => {
                        debug!(client = %self.config.identity.node_id, "ignoring legacy envelope");
                    }
                    LinkMessage::Ping => {
                        debug!(client = %self.config.identity.node_id, "received ping");
                    }
                    LinkMessage::Pong => {
                        debug!(client = %self.config.identity.node_id, "received pong");
                    }
                    LinkMessage::Announce { .. } => {
                        debug!(client = %self.config.identity.node_id, "ignoring announce message");
                    }
                    LinkMessage::ReadRequest(_) => {
                        debug!(client = %self.config.identity.node_id, "ignoring read request");
                    }
                    LinkMessage::ReadResponse(_) => {
                        debug!(client = %self.config.identity.node_id, "ignoring read response");
                    }
                },
                None => {
                    warn!(client = %self.config.identity.node_id, "connection closed");
                    return Ok(None);
                }
            }
        }
    }

    /// Receive the next legacy session envelope.
    pub async fn receive_legacy(&mut self) -> Result<Option<SessionEnvelope>> {
        if self.state != ClientState::Registered {
            anyhow::bail!("client must be registered before receiving");
        }

        loop {
            match self.transport.receive_message().await? {
                Some(message) => match message {
                    LinkMessage::Envelope(envelope) => {
                        debug!(client = %self.config.identity.node_id, "legacy envelope received");
                        return Ok(Some(envelope));
                    }
                    LinkMessage::TypedEnvelope(_) => {
                        debug!(client = %self.config.identity.node_id, "ignoring typed envelope in legacy receive");
                    }
                    _ => {}
                },
                None => {
                    warn!(client = %self.config.identity.node_id, "connection closed");
                    return Ok(None);
                }
            }
        }
    }
}
