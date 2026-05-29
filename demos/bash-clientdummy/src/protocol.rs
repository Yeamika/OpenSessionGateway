//! Protocol helpers: LinkHandshake, Announce, SessionUpdate envelope builders.

use anyhow::Result;
use osgp::{
    Envelope, LinkHandshake, LinkMessage, Payload, ReadRequest, ReadResponse, ResponseStatus,
    RouteTarget, SessionAddress, SessionState, SessionUpdate,
};
use serde_json::json;

/// Build a LinkHandshake JSON string for the initial wire message.
pub fn build_link_handshake_json(node_id: &str) -> Result<String> {
    let hs = LinkHandshake::new(node_id)
        .with_metadata(json!({"role": "endpoint"}));
    Ok(serde_json::to_string(&hs)?)
}

/// Build an Announce LinkMessage for a session address.
pub fn build_announce(address: &SessionAddress) -> LinkMessage {
    LinkMessage::Announce {
        address: address.clone(),
        distance: 0,
    }
}

/// Build a SessionUpdate Envelope (upload/session_update).
pub fn build_session_update_envelope(
    node_id: &str,
    address: &SessionAddress,
    session_id: &str,
    state: SessionState,
    title: Option<&str>,
    summary: Option<&str>,
) -> Envelope {
    let update = SessionUpdate {
        session_id: session_id.into(),
        state,
        title: title.map(Into::into),
        summary: summary.map(Into::into),
        metadata: None,
    };
    Envelope::new(
        RouteTarget::address(address.clone()),
        RouteTarget::session(node_id, session_id),
        Payload::SessionUpdate(update),
    )
}

/// Build a ReadResponse for an inbound ReadRequest (mirror subtype).
pub fn build_response_for_request(
    address: &SessionAddress,
    request: &ReadRequest,
    payload: serde_json::Value,
) -> ReadResponse {
    ReadResponse::ok_for_request(address, request, payload)
}

/// Build an error ReadResponse for an inbound ReadRequest.
#[allow(dead_code)]
pub fn build_error_response_for_request(
    address: &SessionAddress,
    request: &ReadRequest,
    reason: &str,
) -> ReadResponse {
    ReadResponse::error_for_request(address, request, reason)
}

/// Build a smoke response for an inbound control envelope (response/add_prompt, etc.).
pub fn build_control_smoke_response(
    address: &SessionAddress,
    envelope_id: &str,
    subtype: &str,
    source_address: &SessionAddress,
    node_id: &str,
) -> ReadResponse {
    ReadResponse::new(
        address.clone(),
        source_address.clone(),
        subtype,
        envelope_id,
        envelope_id,
        ResponseStatus::Ok,
        json!({"ok": true, "handledBy": node_id, "smoke": true}),
    )
}

/// Format a SessionAddress as domain/runtime/session with * for missing parts.
pub fn format_address(address: &SessionAddress) -> String {
    match (&address.runtime, &address.session) {
        (Some(r), Some(s)) => format!("{}/{}/{}", address.domain, r, s),
        (Some(r), None) => format!("{}/{}/*", address.domain, r),
        (None, Some(s)) => format!("{}/*/{}", address.domain, s),
        (None, None) => format!("{}/*/*", address.domain),
    }
}

/// Parse a slash-separated address string into a SessionAddress.
#[allow(dead_code)]
pub fn parse_address(value: &str) -> Result<SessionAddress> {
    let mut parts = value.split('/');
    let domain = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("address requires domain"))?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    if parts.next().is_some() {
        anyhow::bail!("address must be domain[/runtime[/session]]");
    }
    Ok(SessionAddress::new(domain, runtime, session))
}

/// Build a full SessionAddress from domain, runtime, session components.
pub fn make_session_address(domain: &str, runtime: &str, session: &str) -> SessionAddress {
    SessionAddress::new(
        domain,
        Some(runtime.to_string()),
        Some(session.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_link_handshake_json() {
        let json_str = build_link_handshake_json("test-node").unwrap();
        let v: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(v["protocolVersion"], "osgp/1");
        assert_eq!(v["peerId"], "test-node");
        assert_eq!(v["metadata"]["role"], "endpoint");
    }

    #[test]
    fn test_build_announce() {
        let addr = make_session_address("east", "rt-1", "sess-1");
        let msg = build_announce(&addr);
        match msg {
            LinkMessage::Announce { address, distance } => {
                assert_eq!(address.domain, "east");
                assert_eq!(distance, 0);
            }
            _ => panic!("expected Announce"),
        }
    }

    #[test]
    fn test_build_session_update_envelope() {
        let addr = make_session_address("east", "rt-1", "sess-1");
        let env = build_session_update_envelope(
            "node-1",
            &addr,
            "sess-1",
            SessionState::Running,
            Some("test title"),
            None,
        );
        assert_eq!(env.link_type, osgp::LinkType::Upload);
        assert_eq!(env.subtype, "session_update");
    }

    #[test]
    fn test_format_address_full() {
        let addr = make_session_address("east", "rt-1", "sess-1");
        assert_eq!(format_address(&addr), "east/rt-1/sess-1");
    }

    #[test]
    fn test_format_address_no_session() {
        let addr = SessionAddress::new("east", Some("rt-1".into()), None);
        assert_eq!(format_address(&addr), "east/rt-1/*");
    }

    #[test]
    fn test_parse_address() {
        let addr = parse_address("west/runtime-beta/session-beta-1").unwrap();
        assert_eq!(addr.domain, "west");
        assert_eq!(addr.runtime.as_deref(), Some("runtime-beta"));
        assert_eq!(addr.session.as_deref(), Some("session-beta-1"));
    }

    #[test]
    fn test_parse_address_domain_only() {
        let addr = parse_address("north").unwrap();
        assert_eq!(addr.domain, "north");
        assert!(addr.runtime.is_none());
        assert!(addr.session.is_none());
    }

    #[test]
    fn test_parse_address_too_many_parts() {
        assert!(parse_address("a/b/c/d").is_err());
    }

    #[test]
    fn test_build_session_update_envelope_subtypes() {
        let addr = make_session_address("east", "rt-1", "s1");
        let env = build_session_update_envelope(
            "node-1", &addr, "s1", SessionState::Active, None, None,
        );
        // Validate against canonical subtype registry
        assert!(env.validate().is_ok());
    }
}
