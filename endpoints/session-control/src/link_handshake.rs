use serde::{Deserialize, Serialize};
use serde_json::json;

/// Protocol version for the new LinkHandshake.
pub const PROTOCOL_VERSION: u32 = 1;

/// New LinkHandshake message sent by endpoints to router.
/// Replaces legacy `nodeId/role/addresses/capabilities` hello.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkHandshake {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub protocol_version: u32,
    pub peer_id: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

impl LinkHandshake {
    pub fn new(peer_id: impl Into<String>) -> Self {
        Self {
            msg_type: "link_handshake".into(),
            protocol_version: PROTOCOL_VERSION,
            peer_id: peer_id.into(),
            metadata: json!({}),
        }
    }

    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = metadata;
        self
    }

    pub fn validate(msg: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(msg.clone()).ok().filter(|h: &Self| {
            h.msg_type == "link_handshake"
                && h.protocol_version > 0
                && !h.peer_id.is_empty()
        })
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// Expected handshake acknowledgement from router.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkHandshakeAck {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
}

impl LinkHandshakeAck {
    pub fn from_json(text: &str) -> Option<Self> {
        serde_json::from_str(text).ok().filter(|a: &Self| a.msg_type == "link_handshake_ack")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_new_has_correct_fields() {
        let hs = LinkHandshake::new("session-control-endpoint");
        assert_eq!(hs.msg_type, "link_handshake");
        assert_eq!(hs.protocol_version, PROTOCOL_VERSION);
        assert_eq!(hs.peer_id, "session-control-endpoint");
        assert_eq!(hs.metadata, json!({}));
    }

    #[test]
    fn handshake_with_metadata() {
        let hs = LinkHandshake::new("test").with_metadata(json!({"role": "sc"}));
        assert_eq!(hs.metadata["role"], "sc");
    }

    #[test]
    fn handshake_validate_accepts_valid() {
        let hs = LinkHandshake::new("test");
        let v = serde_json::to_value(&hs).unwrap();
        let validated = LinkHandshake::validate(&v);
        assert!(validated.is_some());
        assert_eq!(validated.unwrap().peer_id, "test");
    }

    #[test]
    fn handshake_validate_rejects_wrong_type() {
        let v = json!({"type": "wrong", "protocol_version": 1, "peer_id": "x"});
        assert!(LinkHandshake::validate(&v).is_none());
    }

    #[test]
    fn handshake_validate_rejects_empty_peer_id() {
        let v = json!({"type": "link_handshake", "protocol_version": 1, "peer_id": ""});
        assert!(LinkHandshake::validate(&v).is_none());
    }

    #[test]
    fn handshake_no_legacy_fields() {
        let hs = LinkHandshake::new("test");
        let v = serde_json::to_value(&hs).unwrap();
        assert!(!v.as_object().unwrap().contains_key("role"));
        assert!(!v.as_object().unwrap().contains_key("capabilities"));
        assert!(!v.as_object().unwrap().contains_key("nodeId"));
        assert!(!v.as_object().unwrap().contains_key("addresses"));
    }

    #[test]
    fn ack_from_json_parses_success() {
        let ack = LinkHandshakeAck::from_json(r#"{"type":"link_handshake_ack","success":true}"#);
        assert!(ack.is_some());
        assert!(ack.unwrap().success);
    }

    #[test]
    fn ack_from_json_parses_failure() {
        let ack = LinkHandshakeAck::from_json(
            r#"{"type":"link_handshake_ack","success":false,"error":"denied"}"#,
        );
        assert!(ack.is_some());
        let ack = ack.unwrap();
        assert!(!ack.success);
        assert_eq!(ack.error.as_deref(), Some("denied"));
    }

    #[test]
    fn ack_from_json_rejects_wrong_type() {
        let ack = LinkHandshakeAck::from_json(r#"{"type":"other","success":true}"#);
        assert!(ack.is_none());
    }
}
