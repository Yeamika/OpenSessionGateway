//! Address primitives: NodeId, SessionId, SessionAddress, RouteTarget, BroadcastScope.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::validation::{validate_non_empty, ValidationError};

// ── NodeId ───────────────────────────────────────────────────────────

/// A node identifier (router or endpoint).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_non_empty("nodeId", &self.0)
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

// ── SessionId ────────────────────────────────────────────────────────

/// A session identifier within a runtime.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_non_empty("sessionId", &self.0)
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// Allow `From<&str>` so downstream can write `"s1".into()`.
impl From<&str> for SessionId {
    fn from(value: &str) -> Self {
        Self(value.into())
    }
}

/// Allow `From<String>` so downstream can write `String::into()`.
impl From<String> for SessionId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

// ── SessionAddress ───────────────────────────────────────────────────

/// Three-level address: `domain[/runtime[/session]]`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAddress {
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
}

impl SessionAddress {
    pub fn new(
        domain: impl Into<String>,
        runtime: Option<String>,
        session: Option<String>,
    ) -> Self {
        Self {
            domain: domain.into(),
            runtime,
            session,
        }
    }

    pub fn domain_only(domain: impl Into<String>) -> Self {
        Self::new(domain, None::<String>, None::<String>)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_non_empty("domain", &self.domain)?;
        Ok(())
    }
}

// ── RouteTarget ──────────────────────────────────────────────────────

/// Route target — either an address, a node, or a node + session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteTarget {
    Address { address: SessionAddress },
    Node { node: NodeId },
    Session { node: NodeId, session: SessionId },
}

impl RouteTarget {
    pub fn address(address: SessionAddress) -> Self {
        Self::Address { address }
    }

    pub fn node(node_id: impl Into<String>) -> Self {
        Self::Node {
            node: NodeId::new(node_id),
        }
    }

    pub fn session(node_id: impl Into<String>, session_id: impl Into<String>) -> Self {
        Self::Session {
            node: NodeId::new(node_id),
            session: SessionId::new(session_id),
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Address { address } => address.validate(),
            Self::Node { node } => node.validate(),
            Self::Session { node, session } => {
                node.validate()?;
                session.validate()
            }
        }
    }
}

// ── Broadcast scope ──────────────────────────────────────────────────

/// Scope for broadcast fan-out.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BroadcastScope {
    Domain,
    Runtime,
    Session,
}
