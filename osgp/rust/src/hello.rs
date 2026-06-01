//! Hello handshake types.
//!
//! ## Migration path
//!
//! - [`HelloMessage`] is the legacy handshake carrying `role`, `capabilities`,
//!   and `addresses`. It remains for backward compatibility but is deprecated
//!   in favor of [`LinkHandshake`].
//! - [`LinkHandshake`] is the vNext handshake: `protocol_version`, `peer_id`,
//!   and optional `metadata`. It does **not** carry addresses; those should
//!   be sent via independent `Announce` / `RouteAdvertisement` messages.
//! - During the compatibility period, routers should accept both. The
//!   recommended transition is:
//!   1. New peers send `LinkHandshake`.
//!   2. Router detects the message shape and parses accordingly.
//!   3. Old peers continue sending `HelloMessage`.
//!   4. Eventually `HelloMessage` is removed.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::address::SessionAddress;

// ── LinkHandshake (vNext) ────────────────────────────────────────────

/// vNext OSGP link handshake.
///
/// Declares peer identity and protocol version. Does **not** carry
/// addresses or role-based capabilities; those are handled by separate
/// `Announce` messages and the rule/policy table.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkHandshake {
    /// Protocol version string (e.g. `"osgp/1"`).
    pub protocol_version: String,
    /// Declared peer identity. Not a strong authentication principal;
    /// trust decisions are made by the rule/policy table.
    pub peer_id: String,
    /// Optional opaque metadata (connection facts, auth claims, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

impl LinkHandshake {
    pub fn new(peer_id: impl Into<String>) -> Self {
        Self {
            protocol_version: "osgp/1".into(),
            peer_id: peer_id.into(),
            metadata: None,
        }
    }

    pub fn with_metadata(mut self, metadata: Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

// ── HelloMessage (legacy, deprecated) ────────────────────────────────

/// Peer role declared during Hello handshake.
///
/// **Deprecated**: role is not used for authorization in the rule/policy
/// model. Kept for backward compatibility with existing endpoints.
#[deprecated(note = "Use LinkHandshake; role is not used for authorization")]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Endpoint,
    Router,
}

/// OSGP Hello handshake message (legacy).
///
/// **Deprecated**: use [`LinkHandshake`] for new peers. Kept for backward
/// compatibility. The `addresses` field is a historical bootstrap mechanism;
/// vNext peers should send addresses via independent `Announce` messages.
#[allow(deprecated)]
#[deprecated(note = "Use LinkHandshake for new peers")]
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

// ── HandshakeKind (discriminated union for parsing) ──────────────────

/// Discriminated enum for parsing either handshake variant from the wire.
///
/// Routers can use this to detect which handshake a peer sent:
/// ```ignore
/// let kind: HandshakeKind = serde_json::from_str(&raw_json)?;
/// match kind {
///     HandshakeKind::Link(hs) => { /* new peer */ }
///     HandshakeKind::Hello(hello) => { /* legacy peer */ }
/// }
/// ```
#[allow(deprecated)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum HandshakeKind {
    Link(LinkHandshake),
    Hello(HelloMessage),
}
