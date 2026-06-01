//! Transport abstractions for the router.
//!
//! Defines peer handles, network roles, and connection metadata used by the router
//! to manage downstream peers and upstream connections.

use osgp::LinkMessage;
use tokio::sync::mpsc;

// ── Peer role ───────────────────────────────────────────────────────

/// Network-layer role of a downstream peer as reported during Hello handshake.
/// Router intentionally does not know user-layer client types such as control,
/// observer, or requestion surfaces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeerRole {
    /// Generic endpoint — all user-layer clients/services/surfaces use this.
    Endpoint,
    /// Another router — participates in route propagation.
    Router,
}

impl PeerRole {
    /// Whether this role participates in route propagation.
    pub fn is_router(&self) -> bool {
        matches!(self, PeerRole::Router)
    }
}

#[allow(deprecated)]
impl From<&PeerRole> for osgp::Role {
    fn from(role: &PeerRole) -> Self {
        match role {
            PeerRole::Endpoint => osgp::Role::Endpoint,
            PeerRole::Router => osgp::Role::Router,
        }
    }
}

#[allow(deprecated)]
impl TryFrom<osgp::Role> for PeerRole {
    type Error = String;

    fn try_from(wire: osgp::Role) -> Result<Self, Self::Error> {
        match wire {
            osgp::Role::Endpoint => Ok(PeerRole::Endpoint),
            osgp::Role::Router => Ok(PeerRole::Router),
        }
    }
}

// ── Peer handle ─────────────────────────────────────────────────────

/// Handle for sending messages to a downstream peer.
///
/// Wraps an unbounded channel sender plus metadata from the peer's
/// Hello/registration handshake.
#[derive(Debug)]
pub struct PeerHandle {
    pub node_id: String,
    pub role: PeerRole,
    pub capabilities: Vec<String>,
    tx: mpsc::UnboundedSender<LinkMessage>,
}

impl PeerHandle {
    pub fn new(
        node_id: impl Into<String>,
        role: PeerRole,
        tx: mpsc::UnboundedSender<LinkMessage>,
    ) -> Self {
        Self {
            node_id: node_id.into(),
            role,
            capabilities: Vec::new(),
            tx,
        }
    }

    pub fn with_capabilities(mut self, capabilities: Vec<String>) -> Self {
        self.capabilities = capabilities;
        self
    }

    pub fn has_capability(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }

    /// Send a link message to this peer.
    pub fn send(&self, message: LinkMessage) -> Result<(), mpsc::error::SendError<LinkMessage>> {
        self.tx.send(message)
    }

    /// Check if the peer's receive channel is still open.
    pub fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }
}

// ── Upstream handle ─────────────────────────────────────────────────

/// Handle for the upstream (parent) router connection.
///
/// In tree topology, a router has 0 or 1 upstream. The upstream handle
/// allows sending messages to the parent and tracking its node_id.
#[derive(Debug)]
pub struct UpstreamHandle {
    /// Node ID of the upstream router (learned from Hello).
    pub node_id: String,
    tx: mpsc::UnboundedSender<LinkMessage>,
}

impl UpstreamHandle {
    pub fn new(node_id: impl Into<String>, tx: mpsc::UnboundedSender<LinkMessage>) -> Self {
        Self {
            node_id: node_id.into(),
            tx,
        }
    }

    /// Send a link message to the upstream router.
    pub fn send(&self, message: LinkMessage) -> Result<(), mpsc::error::SendError<LinkMessage>> {
        self.tx.send(message)
    }

    /// Check if the upstream connection is still alive.
    pub fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use osgp::SessionAddress;

    #[test]
    fn peer_role_network_only() {
        assert!(!PeerRole::Endpoint.is_router());
        assert!(PeerRole::Router.is_router());
    }

    #[test]
    #[allow(deprecated)]
    fn hello_message_serialization() {
        let hello = osgp::HelloMessage {
            node_id: "router-1".into(),
            role: osgp::Role::Endpoint,
            addresses: vec![SessionAddress::new("dom-a", None, None)],
            capabilities: vec!["surface_viewer".into()],
        };
        let json = serde_json::to_string(&hello).unwrap();
        assert!(json.contains("nodeId"));
        assert!(json.contains("endpoint"));

        let de: osgp::HelloMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(de.node_id, "router-1");
        assert_eq!(de.addresses.len(), 1);
        assert_eq!(de.capabilities, vec!["surface_viewer"]);
    }

    #[test]
    fn link_handshake_serialization() {
        let hs = osgp::LinkHandshake::new("router-1");
        let json = serde_json::to_string(&hs).unwrap();
        assert!(json.contains("peerId"));
        assert!(json.contains("osgp/1"));

        let de: osgp::LinkHandshake = serde_json::from_str(&json).unwrap();
        assert_eq!(de.peer_id, "router-1");
    }

    #[test]
    fn peer_handle_send_and_check() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = PeerHandle::new("peer-1", PeerRole::Endpoint, tx);

        assert_eq!(handle.node_id, "peer-1");
        assert!(matches!(handle.role, PeerRole::Endpoint));
        assert!(handle.is_connected());

        let msg = LinkMessage::Announce {
            address: SessionAddress::new("dom", None, None),
            distance: 0,
        };
        handle.send(msg).unwrap();

        let received = rx.try_recv().unwrap();
        assert!(matches!(received, LinkMessage::Announce { .. }));
    }

    #[test]
    fn peer_handle_closed() {
        let (tx, rx) = mpsc::unbounded_channel();
        let handle = PeerHandle::new("peer-1", PeerRole::Router, tx);

        drop(rx);
        assert!(!handle.is_connected());

        let msg = LinkMessage::Ping;
        assert!(handle.send(msg).is_err());
    }

    #[test]
    fn upstream_handle_send_and_check() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = UpstreamHandle::new("parent-router", tx);

        assert_eq!(handle.node_id, "parent-router");
        assert!(handle.is_connected());

        let msg = LinkMessage::Ping;
        handle.send(msg).unwrap();
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn upstream_handle_closed() {
        let (tx, rx) = mpsc::unbounded_channel();
        let handle = UpstreamHandle::new("parent-router", tx);

        drop(rx);
        assert!(!handle.is_connected());
        assert!(handle.send(LinkMessage::Ping).is_err());
    }
}
