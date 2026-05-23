//! Hello handshake types.

use serde::{Deserialize, Serialize};

use crate::address::SessionAddress;

/// Peer role declared during Hello handshake.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Endpoint,
    Router,
}

/// OSGP Hello handshake message.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloMessage {
    pub node_id: String,
    pub role: Role,
    #[serde(default)]
    pub addresses: Vec<SessionAddress>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
}
