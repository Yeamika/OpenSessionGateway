//! Convenience functions for creating clients.

use anyhow::Result;
use osgp::SessionAddress;

use super::client::{Client, ClientConfig, ClientIdentity};
use super::transport::FakeTransportHub;
use super::ws_transport::WebSocketTransportHandle;

/// Create a simple client with fake transport for testing.
pub async fn create_fake_client(
    node_id: &str,
    domain: &str,
    runtime: Option<&str>,
    session: Option<&str>,
    hub: &FakeTransportHub,
) -> Client<super::transport::FakeTransportHandle> {
    let config = ClientConfig {
        identity: ClientIdentity {
            node_id: node_id.to_string(),
            address: SessionAddress::new(
                domain,
                runtime.map(|s| s.to_string()),
                session.map(|s| s.to_string()),
            ),
        },
        auto_reply: false,
    };

    let transport = hub.create_transport(node_id).await;
    Client::new(config, transport)
}

/// Create a client with WebSocket transport for connecting to a real router.
pub async fn create_ws_client(
    node_id: &str,
    domain: &str,
    runtime: Option<&str>,
    session: Option<&str>,
    router_url: &str,
) -> Result<Client<WebSocketTransportHandle>> {
    let config = ClientConfig {
        identity: ClientIdentity {
            node_id: node_id.to_string(),
            address: SessionAddress::new(
                domain,
                runtime.map(|s| s.to_string()),
                session.map(|s| s.to_string()),
            ),
        },
        auto_reply: false,
    };

    let transport = WebSocketTransportHandle::connect(router_url).await?;
    Ok(Client::new(config, transport))
}
