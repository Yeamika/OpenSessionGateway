use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct RouteAddress {
    pub domain_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl RouteAddress {
    pub fn new(
        domain_id: impl Into<String>,
        runtime_id: Option<impl Into<String>>,
        session_id: Option<impl Into<String>>,
    ) -> Self {
        Self {
            domain_id: domain_id.into(),
            runtime_id: runtime_id.map(Into::into),
            session_id: session_id.map(Into::into),
        }
    }

    pub fn domain(domain_id: impl Into<String>) -> Self {
        Self::new(domain_id, Option::<String>::None, Option::<String>::None)
    }

    pub fn key(&self) -> String {
        format!(
            "{}/{}/{}",
            self.domain_id,
            self.runtime_id.as_deref().unwrap_or("*"),
            self.session_id.as_deref().unwrap_or("*"),
        )
    }

    pub fn runtime_key(&self) -> Option<String> {
        self.runtime_id
            .as_ref()
            .map(|runtime| format!("{}/{}/{}", self.domain_id, runtime, "*"))
    }

    pub fn domain_key(&self) -> String {
        format!("{}/{}/{}", self.domain_id, "*", "*")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RouteAnnouncement {
    pub address: RouteAddress,
    /// Distance from the announcing node to the address.
    /// A directly attached client/session announces distance 0.
    pub distance: u16,
}

impl RouteAnnouncement {
    pub fn local(address: RouteAddress) -> Self {
        Self {
            address,
            distance: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeRole {
    Router,
    Client,
    Panel,
    Surface,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEnvelope {
    pub message_id: String,
    pub trace_id: String,
    pub ttl: u8,
    pub source: RouteAddress,
    pub target: RouteAddress,
    pub kind: String,
    #[serde(default)]
    pub route_hops: Vec<String>,
    pub payload: Value,
}

impl RouteEnvelope {
    pub fn new(
        source: RouteAddress,
        target: RouteAddress,
        kind: impl Into<String>,
        payload: Value,
    ) -> Self {
        let message_id = Uuid::new_v4().to_string();
        Self {
            trace_id: message_id.clone(),
            message_id,
            ttl: 16,
            source,
            target,
            kind: kind.into(),
            route_hops: Vec::new(),
            payload,
        }
    }

    pub fn hop(mut self, router_id: impl Into<String>) -> Option<Self> {
        if self.ttl == 0 {
            return None;
        }
        self.ttl -= 1;
        self.route_hops.push(router_id.into());
        Some(self)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireMessage {
    Hello {
        node_id: String,
        role: NodeRole,
        routes: Vec<RouteAnnouncement>,
    },
    RouteUpdate {
        node_id: String,
        routes: Vec<RouteAnnouncement>,
    },
    Envelope {
        envelope: RouteEnvelope,
    },
}
