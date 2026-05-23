//! Transport abstraction traits for the GlassVein router.
//!
//! **NOTE: Draft interfaces — pending alignment with the planned
//! `session-links/clientlib` crate.** These traits define the contract
//! that downstream and upstream transports must satisfy. The current
//! router implementation uses `mpsc::UnboundedSender<WireMessage>` channels
//! directly; these traits are provided as a reference for future transport
//! adapters.
//!
//! When `session-links/clientlib` is implemented, these traits should be
//! moved there and the router should depend on them instead of concrete
//! channel types.

use glassvein_protocol::{NodeRole, WireMessage};
use serde::{Deserialize, Serialize};
use std::fmt;

// ── Error types ─────────────────────────────────────────────────────

/// Errors that can occur when sending a message through a transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportError {
    pub message: String,
    pub kind: TransportErrorKind,
}

/// Kind of transport error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportErrorKind {
    /// The connection was closed.
    Closed,
    /// The send buffer is full (backpressure).
    Full,
    /// Serialization failed.
    Serialize,
    /// Connection attempt failed.
    ConnectionFailed,
    /// Send operation failed.
    SendFailed,
    /// Receive operation failed.
    ReceiveFailed,
    /// Protocol-level error.
    ProtocolError,
    /// Operation timed out.
    Timeout,
}

impl TransportError {
    pub fn closed() -> Self {
        Self {
            message: "transport closed".into(),
            kind: TransportErrorKind::Closed,
        }
    }

    pub fn full() -> Self {
        Self {
            message: "transport buffer full".into(),
            kind: TransportErrorKind::Full,
        }
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            kind: TransportErrorKind::ConnectionFailed,
        }
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for TransportError {}

impl fmt::Display for TransportErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => write!(f, "closed"),
            Self::Full => write!(f, "full"),
            Self::Serialize => write!(f, "serialize"),
            Self::ConnectionFailed => write!(f, "connection_failed"),
            Self::SendFailed => write!(f, "send_failed"),
            Self::ReceiveFailed => write!(f, "receive_failed"),
            Self::ProtocolError => write!(f, "protocol_error"),
            Self::Timeout => write!(f, "timeout"),
        }
    }
}

// ── Peer sink trait ─────────────────────────────────────────────────

/// Abstraction for sending wire messages to a downstream peer.
///
/// A peer is a node that connects to this router as a downstream client
/// (Client, Panel, Surface, or another Router acting as a child).
///
/// **Draft interface — pending alignment with `session-links/clientlib`.**
pub trait PeerSink: Send + Sync + 'static {
    /// Unique identifier for this peer (typically the node_id from Hello).
    fn peer_id(&self) -> &str;

    /// Role reported by this peer during Hello handshake.
    fn role(&self) -> &NodeRole;

    /// Send a wire message to this peer.
    fn send(&self, message: WireMessage) -> Result<(), TransportError>;

    /// Check if this peer's connection is still alive.
    fn is_connected(&self) -> bool;
}

// ── Upstream sink trait ──────────────────────────────────────────────

/// Abstraction for sending wire messages to an upstream router.
///
/// An upstream is a parent or sibling router that this node connects to
/// as a client (outbound WebSocket connection).
///
/// **Draft interface — pending alignment with `session-links/clientlib`.**
pub trait UpstreamSink: Send + Sync + 'static {
    /// Unique identifier for this upstream (typically the URL or node_id).
    fn upstream_id(&self) -> &str;

    /// Send a wire message to this upstream.
    fn send(&self, message: WireMessage) -> Result<(), TransportError>;

    /// Check if this upstream connection is still alive.
    fn is_connected(&self) -> bool;
}

// ── Channel-based implementations ───────────────────────────────────
// These are provided as reference implementations for the current
// channel-based approach.

use tokio::sync::mpsc;

/// A channel-backed peer sink.
///
/// Wraps an `mpsc::UnboundedSender<WireMessage>` and metadata from the
/// peer's Hello handshake.
pub struct ChannelPeerSink {
    peer_id: String,
    role: NodeRole,
    tx: mpsc::UnboundedSender<WireMessage>,
}

impl ChannelPeerSink {
    pub fn new(peer_id: String, role: NodeRole, tx: mpsc::UnboundedSender<WireMessage>) -> Self {
        Self { peer_id, role, tx }
    }
}

impl PeerSink for ChannelPeerSink {
    fn peer_id(&self) -> &str {
        &self.peer_id
    }

    fn role(&self) -> &NodeRole {
        &self.role
    }

    fn send(&self, message: WireMessage) -> Result<(), TransportError> {
        self.tx.send(message).map_err(|_| TransportError::closed())
    }

    fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }
}

/// A channel-backed upstream sink.
pub struct ChannelUpstreamSink {
    upstream_id: String,
    tx: mpsc::UnboundedSender<WireMessage>,
}

impl ChannelUpstreamSink {
    pub fn new(upstream_id: String, tx: mpsc::UnboundedSender<WireMessage>) -> Self {
        Self { upstream_id, tx }
    }
}

impl UpstreamSink for ChannelUpstreamSink {
    fn upstream_id(&self) -> &str {
        &self.upstream_id
    }

    fn send(&self, message: WireMessage) -> Result<(), TransportError> {
        self.tx.send(message).map_err(|_| TransportError::closed())
    }

    fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }
}

// ── Legacy type aliases (backward compat) ───────────────────────────

/// Legacy struct — prefer using the `PeerSink` trait instead.
#[derive(Debug, Clone)]
pub struct LegacyPeerSink {
    pub peer_id: String,
}

impl LegacyPeerSink {
    pub fn new(peer_id: impl Into<String>) -> Self {
        Self {
            peer_id: peer_id.into(),
        }
    }
}

/// Legacy struct — prefer using the `UpstreamSink` trait instead.
#[derive(Debug, Clone)]
pub struct LegacyUpstreamSink {
    pub upstream_id: String,
}

impl LegacyUpstreamSink {
    pub fn new(upstream_id: impl Into<String>) -> Self {
        Self {
            upstream_id: upstream_id.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_error_display() {
        let err = TransportError::connection_failed("connection refused");
        assert_eq!(err.to_string(), "connection_failed: connection refused");
    }

    #[test]
    fn transport_error_closed_display() {
        let err = TransportError::closed();
        assert_eq!(err.to_string(), "closed: transport closed");
    }

    #[test]
    fn channel_peer_sink_send_and_check() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sink = ChannelPeerSink::new("peer-1".into(), NodeRole::Client, tx);

        assert_eq!(sink.peer_id(), "peer-1");
        assert!(matches!(sink.role(), NodeRole::Client));
        assert!(sink.is_connected());

        let msg = WireMessage::Hello {
            node_id: "test".into(),
            role: NodeRole::Client,
            routes: vec![],
        };
        sink.send(msg).unwrap();

        let received = rx.try_recv().unwrap();
        assert!(matches!(received, WireMessage::Hello { .. }));
    }

    #[test]
    fn channel_peer_sink_closed() {
        let (tx, rx) = mpsc::unbounded_channel();
        let sink = ChannelPeerSink::new("peer-1".into(), NodeRole::Client, tx);

        drop(rx); // close the receiver
        assert!(!sink.is_connected());

        let msg = WireMessage::Hello {
            node_id: "test".into(),
            role: NodeRole::Client,
            routes: vec![],
        };
        assert!(sink.send(msg).is_err());
    }

    #[test]
    fn channel_upstream_sink_send_and_check() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sink = ChannelUpstreamSink::new("upstream-1".into(), tx);

        assert_eq!(sink.upstream_id(), "upstream-1");
        assert!(sink.is_connected());

        let msg = WireMessage::RouteUpdate {
            node_id: "test".into(),
            routes: vec![],
        };
        sink.send(msg).unwrap();

        let received = rx.try_recv().unwrap();
        assert!(matches!(received, WireMessage::RouteUpdate { .. }));
    }

    #[test]
    fn legacy_peer_sink_creation() {
        let sink = LegacyPeerSink::new("peer-1");
        assert_eq!(sink.peer_id, "peer-1");
    }

    #[test]
    fn legacy_upstream_sink_creation() {
        let sink = LegacyUpstreamSink::new("upstream-1");
        assert_eq!(sink.upstream_id, "upstream-1");
    }
}
