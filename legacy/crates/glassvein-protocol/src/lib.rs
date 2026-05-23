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
        envelope: Box<RouteEnvelope>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── RouteAddress ──────────────────────────────────────────────

    #[test]
    fn route_address_key_full() {
        let addr = RouteAddress::new("dom", Some("rt"), Some("ses"));
        assert_eq!(addr.key(), "dom/rt/ses");
    }

    #[test]
    fn route_address_key_wildcard_runtime() {
        let addr = RouteAddress::new("dom", None::<String>, Some("ses"));
        assert_eq!(addr.key(), "dom/*/ses");
    }

    #[test]
    fn route_address_key_wildcard_session() {
        let addr = RouteAddress::new("dom", Some("rt"), None::<String>);
        assert_eq!(addr.key(), "dom/rt/*");
    }

    #[test]
    fn route_address_key_domain_only() {
        let addr = RouteAddress::domain("dom");
        assert_eq!(addr.key(), "dom/*/*");
    }

    #[test]
    fn route_address_runtime_key_present() {
        let addr = RouteAddress::new("dom", Some("rt"), Some("ses"));
        assert_eq!(addr.runtime_key(), Some("dom/rt/*".to_string()));
    }

    #[test]
    fn route_address_runtime_key_absent() {
        let addr = RouteAddress::domain("dom");
        assert!(addr.runtime_key().is_none());
    }

    #[test]
    fn route_address_domain_key() {
        let addr = RouteAddress::new("dom", Some("rt"), Some("ses"));
        assert_eq!(addr.domain_key(), "dom/*/*");
    }

    #[test]
    fn route_address_serde_roundtrip() {
        let addr = RouteAddress::new("dom", Some("rt"), Some("ses"));
        let json = serde_json::to_string(&addr).unwrap();
        // camelCase: domainId, runtimeId, sessionId
        assert!(json.contains("\"domainId\""), "expected camelCase domainId");
        assert!(
            json.contains("\"runtimeId\""),
            "expected camelCase runtimeId"
        );
        assert!(
            json.contains("\"sessionId\""),
            "expected camelCase sessionId"
        );
        let de: RouteAddress = serde_json::from_str(&json).unwrap();
        assert_eq!(de, addr);
    }

    #[test]
    fn route_address_serde_optional_fields_omitted() {
        let addr = RouteAddress::domain("dom");
        let json = serde_json::to_string(&addr).unwrap();
        assert!(
            !json.contains("runtimeId"),
            "optional runtimeId should be omitted"
        );
        assert!(
            !json.contains("sessionId"),
            "optional sessionId should be omitted"
        );
        let de: RouteAddress = serde_json::from_str(&json).unwrap();
        assert_eq!(de, addr);
    }

    // ── RouteEnvelope ─────────────────────────────────────────────

    #[test]
    fn route_envelope_serde_roundtrip() {
        let src = RouteAddress::new("d1", Some("r1"), Some("s1"));
        let tgt = RouteAddress::new("d2", Some("r2"), Some("s2"));
        let env = RouteEnvelope::new(
            src.clone(),
            tgt.clone(),
            "test",
            serde_json::json!({"hello": "world"}),
        );

        let json = serde_json::to_string(&env).unwrap();
        // camelCase fields
        assert!(
            json.contains("\"messageId\""),
            "expected camelCase messageId"
        );
        assert!(json.contains("\"traceId\""), "expected camelCase traceId");
        assert!(
            json.contains("\"routeHops\""),
            "expected camelCase routeHops"
        );
        assert!(json.contains("\"source\""));
        assert!(json.contains("\"target\""));

        let de: RouteEnvelope = serde_json::from_str(&json).unwrap();
        assert_eq!(de.message_id, env.message_id);
        assert_eq!(de.trace_id, env.trace_id);
        assert_eq!(de.ttl, env.ttl);
        assert_eq!(de.source, src);
        assert_eq!(de.target, tgt);
        assert_eq!(de.kind, "test");
        assert!(de.route_hops.is_empty());
        assert_eq!(de.payload["hello"], "world");
    }

    #[test]
    fn route_envelope_hop_decrements_ttl() {
        let src = RouteAddress::domain("d");
        let tgt = RouteAddress::domain("d2");
        let env = RouteEnvelope::new(src, tgt, "ping", serde_json::json!(null));
        assert_eq!(env.ttl, 16);
        let env = env.hop("router-A").unwrap();
        assert_eq!(env.ttl, 15);
        assert_eq!(env.route_hops, vec!["router-A"]);
    }

    #[test]
    fn route_envelope_hop_returns_none_at_ttl_zero() {
        let src = RouteAddress::domain("d");
        let tgt = RouteAddress::domain("d2");
        let mut env = RouteEnvelope::new(src, tgt, "ping", serde_json::json!(null));
        env.ttl = 0;
        assert!(env.hop("router-A").is_none());
    }

    // ── WireMessage::Envelope wire format ─────────────────────────

    #[test]
    fn wire_message_envelope_json_format() {
        // The key contract: WireMessage::Envelope must serialize as
        // {"type":"envelope","envelope":{...}}
        // NOT {"type":"envelope","envelope":{"envelope":{...}}}
        let src = RouteAddress::new("dom", Some("rt"), Some("ses"));
        let tgt = RouteAddress::new("dom2", Some("rt2"), Some("ses2"));
        let inner = RouteEnvelope::new(src, tgt, "msg", serde_json::json!({"key": 42}));
        let msg = WireMessage::Envelope {
            envelope: Box::new(inner),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();

        // type tag
        assert_eq!(val["type"], "envelope", "type tag must be 'envelope'");

        // envelope is the RouteEnvelope directly, not doubly-nested
        assert!(val["envelope"].is_object(), "'envelope' must be an object");
        assert!(
            val["envelope"]["envelope"].is_null(),
            "envelope must NOT be doubly-nested (no envelope.envelope)"
        );

        // Spot-check inner fields are at val.envelope.*
        assert!(
            val["envelope"]["messageId"].is_string(),
            "envelope.messageId must exist"
        );
        assert!(
            val["envelope"]["source"].is_object(),
            "envelope.source must exist"
        );
        assert!(
            val["envelope"]["target"].is_object(),
            "envelope.target must exist"
        );
        assert_eq!(val["envelope"]["kind"], "msg");
        assert_eq!(val["envelope"]["payload"]["key"], 42);
    }

    #[test]
    fn wire_message_envelope_roundtrip() {
        let src = RouteAddress::new("d", Some("r"), Some("s"));
        let tgt = RouteAddress::new("d2", None::<String>, None::<String>);
        let inner = RouteEnvelope::new(src, tgt, "test", serde_json::json!(null));
        let msg = WireMessage::Envelope {
            envelope: Box::new(inner),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let de: WireMessage = serde_json::from_str(&json).unwrap();

        match de {
            WireMessage::Envelope { envelope } => {
                assert_eq!(envelope.kind, "test");
                assert_eq!(envelope.ttl, 16);
            }
            other => panic!("expected Envelope variant, got: {:?}", other),
        }
    }

    #[test]
    fn wire_message_hello_serde_roundtrip() {
        let routes = vec![RouteAnnouncement::local(RouteAddress::domain("d"))];
        let msg = WireMessage::Hello {
            node_id: "n1".into(),
            role: NodeRole::Router,
            routes,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["type"], "hello");
        assert_eq!(val["node_id"], "n1");
        assert_eq!(val["role"], "router");

        let de: WireMessage = serde_json::from_str(&json).unwrap();
        match de {
            WireMessage::Hello { node_id, role, .. } => {
                assert_eq!(node_id, "n1");
                assert_eq!(role, NodeRole::Router);
            }
            other => panic!("expected Hello variant, got: {:?}", other),
        }
    }
}
