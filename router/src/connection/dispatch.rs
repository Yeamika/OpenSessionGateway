//! Message dispatch and route learning.

use osgp::{LinkMessage, SessionAddress};
use tracing::debug;

use crate::transport::PeerRole;

use super::ConnectionManager;

impl ConnectionManager {
    /// Dispatch an incoming message based on type and sender role.
    ///
    /// If an `on_message` callback is set, it is called first. If it returns
    /// `true`, the message is considered handled. Otherwise, default handling
    /// is applied (route learning for Announce, logging for others).
    pub(crate) async fn dispatch_message(
        &self,
        from_id: &str,
        _from_role: &PeerRole,
        message: LinkMessage,
    ) {
        // If a message handler is registered, delegate to it
        {
            let handler_guard = self.on_message.lock().await;
            if let Some(handler) = handler_guard.as_ref() {
                if handler(from_id.to_string(), message.clone()) {
                    return; // handled by callback
                }
            }
        }

        // Default handling: learn routes from Announce, log others
        match message {
            LinkMessage::Announce { address, distance } => {
                self.learn_route_from_peer(from_id, address, distance).await;
            }
            LinkMessage::Envelope(envelope) => {
                debug!(
                    router = %self.node_id,
                    from = %from_id,
                    envelope_id = %envelope.id,
                    "received envelope (no handler registered)"
                );
            }
            LinkMessage::TypedEnvelope(envelope) => {
                debug!(
                    router = %self.node_id,
                    from = %from_id,
                    message_id = %envelope.message_id,
                    "received typed envelope (no handler registered)"
                );
            }
            LinkMessage::ReadRequest(request) => {
                debug!(
                    router = %self.node_id,
                    from = %from_id,
                    request_id = %request.request_id,
                    source = %crate::format_address(&request.source),
                    op = %request.operation.op_name(),
                    "received read request (no handler registered)"
                );
            }
            LinkMessage::ReadResponse(response) => {
                debug!(
                    router = %self.node_id,
                    from = %from_id,
                    request_id = %response.request_id,
                    is_ok = response.is_ok(),
                    "received read response (no handler registered)"
                );
            }
            LinkMessage::Ping => {
                debug!(router = %self.node_id, from = %from_id, "ping");
            }
            LinkMessage::Pong => {
                debug!(router = %self.node_id, from = %from_id, "pong");
            }
        }
    }

    /// Learn a route announced by a peer.
    pub(crate) async fn learn_route_from_peer(
        &self,
        peer_id: &str,
        address: SessionAddress,
        distance: u32,
    ) {
        self.peer_routes
            .write()
            .await
            .entry(peer_id.to_string())
            .or_default()
            .push(address.clone());

        debug!(
            router = %self.node_id,
            peer = %peer_id,
            address = %crate::format_address(&address),
            distance,
            "route learned"
        );
    }
}
