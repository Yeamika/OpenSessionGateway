//! Tests for requestion endpoint read/envelope handlers.

use super::*;
use crate::cache::RequestionCache;
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionEnvelope, SessionId};
use serde_json::json;

fn test_self_address() -> SessionAddress {
    SessionAddress::new(
        "domain-a",
        Some("requestion-endpoint".into()),
        Some("requestion-endpoint".into()),
    )
}

fn test_requester_address() -> SessionAddress {
    SessionAddress::new("domain-a", Some("rt-opencode".into()), Some("ses-1".into()))
}

/// Build a ReadRequest with canonical source/target addressing.
fn make_request(op: ReadOperation) -> ReadRequest {
    ReadRequest::new(test_requester_address(), test_self_address(), op)
}

/// Populate cache with 3 requestions across 2 sessions.
fn populate_cache(cache: &mut RequestionCache) {
    cache.upsert(
        "ses-1".into(),
        "req-1".into(),
        "Allow deploy".into(),
        test_requester_address(),
        "requestion_asked".into(),
        json!({}),
    );
    cache.upsert(
        "ses-1".into(),
        "req-2".into(),
        "Grant access".into(),
        test_requester_address(),
        "permission_asked".into(),
        json!({}),
    );
    cache.upsert(
        "ses-2".into(),
        "req-3".into(),
        "Confirm action".into(),
        SessionAddress::new("domain-a", Some("rt-opencode".into()), Some("ses-2".into())),
        "question_asked".into(),
        json!({}),
    );
}

// ── Response source/target addressing ──

#[tokio::test]
async fn response_source_is_self_address() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt-1".into(),
        session_id: None,
        status: None,
        blocking: false,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.source, self_addr);
}

#[tokio::test]
async fn response_target_is_request_source() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt-1".into(),
        session_id: None,
        status: None,
        blocking: false,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.target, test_requester_address());
}

// ── RequestionSnapshot (compat alias) → canonical subtype ──

#[tokio::test]
async fn compat_requestion_snapshot_uses_canonical_subtype() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RequestionSnapshot {
        session_id: SessionId::from("ses-1"),
        status: None,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.subtype, RESPONSE_SUBTYPE);
    assert!(response.is_ok());
    assert_eq!(response.payload["count"], 2);
    assert_eq!(response.payload["sessionID"], "ses-1");
}

// ── RuntimeRequestionSnapshot — canonical path ──

#[tokio::test]
async fn runtime_requestion_snapshot_with_session_scope() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt-1".into(),
        session_id: Some(SessionId::from("ses-1")),
        status: None,
        blocking: false,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.subtype, RESPONSE_SUBTYPE);
    assert!(response.is_ok());
    assert_eq!(response.payload["count"], 2);
    assert_eq!(response.payload["sessionID"], "ses-1");
    assert_eq!(response.payload["runtimeID"], "rt-1");
}

#[tokio::test]
async fn runtime_requestion_snapshot_runtime_wide() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt-1".into(),
        session_id: None,
        status: None,
        blocking: false,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.subtype, RESPONSE_SUBTYPE);
    assert!(response.is_ok());
    assert_eq!(response.payload["count"], 3);
    assert_eq!(response.payload["runtimeID"], "rt-1");
    assert!(payload_get_str(&response.payload, "sessionID").is_none());
}

#[tokio::test]
async fn runtime_requestion_snapshot_with_status_filter() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt-1".into(),
        session_id: None,
        status: Some("asked".into()),
        blocking: false,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.subtype, RESPONSE_SUBTYPE);
    assert!(response.is_ok());
    assert_eq!(response.payload["count"], 3);
}

// ── SessionViewSnapshot ──

#[tokio::test]
async fn session_view_snapshot_maps_to_canonical_subtype() {
    let cache = Arc::new(RwLock::new(RequestionCache::new()));
    populate_cache(&mut *cache.write().await);
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let self_addr = test_self_address();

    let request = make_request(ReadOperation::SessionViewSnapshot {
        session_id: SessionId::from("ses-1"),
        requestion_status: None,
    });
    let response = build_read_response(&request, &session_cache, &cache, &self_addr).await;

    assert_eq!(response.subtype, "runtime_session_view_snapshot");
    assert!(response.is_ok());
    assert_eq!(response.payload["requestionCount"], 2);
}

// ── filter_by_suffix ──

#[test]
fn filter_by_suffix_asked() {
    let items = vec![
        make_pending("requestion_asked"),
        make_pending("requestion_resolved"),
        make_pending("permission_asked"),
    ];
    let refs: Vec<&PendingRequestion> = items.iter().collect();
    let filtered = filter_by_suffix(refs, Some("asked"));
    assert_eq!(filtered.len(), 2);
}

#[test]
fn filter_by_suffix_none_returns_all() {
    let items = vec![
        make_pending("requestion_asked"),
        make_pending("permission_resolved"),
    ];
    let refs: Vec<&PendingRequestion> = items.iter().collect();
    let filtered = filter_by_suffix(refs, None);
    assert_eq!(filtered.len(), 2);
}

// ── canonical upload lifecycle ──

#[tokio::test]
async fn canonical_upload_asked_updated_resolved_lifecycle() {
    let sessions = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestions = Arc::new(RwLock::new(RequestionCache::new()));

    handle_envelope(
        &upload(
            "requestion_asked",
            json!({
                "sessionID": "ses-1",
                "requestID": "req-1",
                "title": "Initial"
            }),
        ),
        &sessions,
        &requestions,
    )
    .await;
    assert_eq!(requestions.read().await.get_by_session("ses-1").len(), 1);
    assert_eq!(
        requestions
            .read()
            .await
            .get_for_web("ses-1", "req-1")
            .unwrap()
            .source,
        test_requester_address()
    );

    handle_envelope(
        &upload(
            "requestion_updated",
            json!({
                "sessionID": "ses-1",
                "requestID": "req-1",
                "title": "Updated"
            }),
        ),
        &sessions,
        &requestions,
    )
    .await;
    assert_eq!(
        requestions
            .read()
            .await
            .get_for_web("ses-1", "req-1")
            .unwrap()
            .title,
        "Updated"
    );

    handle_envelope(
        &upload(
            "requestion_resolved",
            json!({
                "sessionID": "ses-1",
                "requestID": "req-1"
            }),
        ),
        &sessions,
        &requestions,
    )
    .await;
    assert!(requestions.read().await.get_by_session("ses-1").is_empty());
}

#[tokio::test]
async fn canonical_cancelled_and_duplicate_resolved_are_idempotent() {
    let sessions = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestions = Arc::new(RwLock::new(RequestionCache::new()));
    handle_envelope(
        &upload(
            "requestion_asked",
            json!({"sessionID":"ses-1","requestID":"req-1"}),
        ),
        &sessions,
        &requestions,
    )
    .await;
    handle_envelope(
        &upload(
            "requestion_cancelled",
            json!({"sessionID":"ses-1","requestID":"req-1"}),
        ),
        &sessions,
        &requestions,
    )
    .await;
    handle_envelope(
        &upload(
            "requestion_resolved",
            json!({"sessionID":"ses-1","requestID":"req-1"}),
        ),
        &sessions,
        &requestions,
    )
    .await;
    assert!(requestions.read().await.get_all().is_empty());
}

#[tokio::test]
async fn dotted_compat_requestion_input_is_still_cached() {
    let sessions = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestions = Arc::new(RwLock::new(RequestionCache::new()));
    let mut envelope = upload(
        "ignored",
        json!({
            "sessionID": "ses-1",
            "requestID": "req-compat",
            "title": "Compat"
        }),
    );
    envelope.link_type = "legacy".into();
    envelope.payload["eventSubtype"] = json!("requestion.asked");
    handle_envelope(&envelope, &sessions, &requestions).await;
    // The compat path normalizes dot-form to canonical underscore form
    assert!(requestions
        .read()
        .await
        .get_for_web("ses-1", "req-compat")
        .is_some());
    assert_eq!(
        requestions
            .read()
            .await
            .get_for_web("ses-1", "req-compat")
            .unwrap()
            .event_subtype,
        "requestion_asked"
    );
}

#[tokio::test]
async fn missing_session_or_request_id_is_ignored() {
    let sessions = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestions = Arc::new(RwLock::new(RequestionCache::new()));
    let mut envelope = upload("requestion_asked", json!({"requestID":"req-1"}));
    envelope.source.session = None;
    handle_envelope(&envelope, &sessions, &requestions).await;
    handle_envelope(
        &upload("requestion_asked", json!({"sessionID":"ses-1"})),
        &sessions,
        &requestions,
    )
    .await;
    assert!(requestions.read().await.get_all().is_empty());
}

// ── helpers ──

fn make_pending(event_subtype: &str) -> PendingRequestion {
    PendingRequestion {
        session_id: "s".into(),
        request_id: "r".into(),
        title: "t".into(),
        source: test_requester_address(),
        event_subtype: event_subtype.into(),
        payload: json!({}),
        updated_at: "0.000".into(),
    }
}

fn upload(subtype: &str, payload: Value) -> SessionEnvelope {
    let mut envelope = SessionEnvelope::new(
        test_requester_address(),
        test_self_address(),
        "upload",
        payload,
    );
    envelope.link_type = "upload".into();
    envelope.subtype = subtype.into();
    envelope
}

fn payload_get_str(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(|v| v.as_str()).map(String::from)
}

// ── Handshake tests ─────────────────────────────────────────────────

/// LinkHandshake (vNext) serializes with protocol_version + peer_id,
/// no role/capabilities/addresses.
#[test]
fn link_handshake_serialization() {
    let hs = osgp::LinkHandshake::new("requestion-endpoint");
    let json = serde_json::to_value(&hs).unwrap();
    assert_eq!(json["protocolVersion"], "osgp/1");
    assert_eq!(json["peerId"], "requestion-endpoint");
    // LinkHandshake must NOT have legacy fields
    assert!(json.get("nodeId").is_none());
    assert!(json.get("role").is_none());
    assert!(json.get("capabilities").is_none());
    assert!(json.get("addresses").is_none());
}

/// LinkHandshake round-trips through serde.
#[test]
fn link_handshake_roundtrip() {
    let hs = osgp::LinkHandshake::new("test-peer")
        .with_metadata(serde_json::json!({"key": "value"}));
    let json_str = serde_json::to_string(&hs).unwrap();
    let parsed: osgp::LinkHandshake = serde_json::from_str(&json_str).unwrap();
    assert_eq!(parsed.peer_id, "test-peer");
    assert_eq!(parsed.protocol_version, "osgp/1");
    assert_eq!(parsed.metadata.unwrap()["key"], "value");
}

/// Router's parse_hello_frame logic: LinkHandshake is detected first.
#[test]
fn router_parse_hello_frame_detects_link_handshake() {
    let hs = osgp::LinkHandshake::new("my-endpoint");
    let text = serde_json::to_string(&hs).unwrap();

    // Simulate router's detection: try LinkHandshake first
    let parsed_hs: osgp::LinkHandshake = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed_hs.peer_id, "my-endpoint");
    assert_eq!(parsed_hs.protocol_version, "osgp/1");
}

/// Router's parse_hello_frame logic: legacy HelloMessage is fallback.
#[test]
fn router_parse_hello_frame_falls_back_to_legacy_hello() {
    #[allow(deprecated)]
    let hello = osgp::HelloMessage {
        node_id: "legacy-endpoint".to_string(),
        role: osgp::Role::Endpoint,
        addresses: vec![osgp::SessionAddress::new(
            "domain-a",
            Some("rt".into()),
            Some("ses".into()),
        )],
        capabilities: vec!["surface_viewer".into()],
    };
    let text = serde_json::to_string(&hello).unwrap();

    // LinkHandshake parse should fail (has "role" field which is not in LinkHandshake)
    let hs_result = serde_json::from_str::<osgp::LinkHandshake>(&text);
    assert!(hs_result.is_err(), "LinkHandshake should not parse legacy HelloMessage");

    // Legacy parse should succeed
    #[allow(deprecated)]
    let parsed: osgp::HelloMessage = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed.node_id, "legacy-endpoint");
    assert_eq!(parsed.role, osgp::Role::Endpoint);
}

/// HandshakeKind discriminated union: LinkHandshake variant.
#[test]
fn handshake_kind_parses_link_handshake() {
    let hs = osgp::LinkHandshake::new("peer-1");
    let text = serde_json::to_string(&hs).unwrap();
    let kind: osgp::HandshakeKind = serde_json::from_str(&text).unwrap();
    match kind {
        osgp::HandshakeKind::Link(h) => assert_eq!(h.peer_id, "peer-1"),
        _ => panic!("expected Link variant"),
    }
}

/// HandshakeKind discriminated union: legacy HelloMessage variant.
#[test]
fn handshake_kind_parses_legacy_hello() {
    #[allow(deprecated)]
    let hello = osgp::HelloMessage {
        node_id: "peer-2".to_string(),
        role: osgp::Role::Endpoint,
        addresses: vec![],
        capabilities: vec![],
    };
    let text = serde_json::to_string(&hello).unwrap();
    let kind: osgp::HandshakeKind = serde_json::from_str(&text).unwrap();
    match kind {
        osgp::HandshakeKind::Hello(h) => assert_eq!(h.node_id, "peer-2"),
        _ => panic!("expected Hello variant"),
    }
}
