//! Tests for requestion endpoint read/envelope handlers.

use super::*;
use crate::cache::RequestionCache;
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionEnvelope, SessionId};
use serde_json::json;
use uuid::Uuid;

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
        "requestion.asked".into(),
        json!({}),
    );
    cache.upsert(
        "ses-1".into(),
        "req-2".into(),
        "Grant access".into(),
        test_requester_address(),
        "permission.asked".into(),
        json!({}),
    );
    cache.upsert(
        "ses-2".into(),
        "req-3".into(),
        "Confirm action".into(),
        SessionAddress::new("domain-a", Some("rt-opencode".into()), Some("ses-2".into())),
        "question.asked".into(),
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
        make_pending("requestion.asked"),
        make_pending("requestion.resolved"),
        make_pending("permission.asked"),
    ];
    let refs: Vec<&PendingRequestion> = items.iter().collect();
    let filtered = filter_by_suffix(refs, Some("asked"));
    assert_eq!(filtered.len(), 2);
}

#[test]
fn filter_by_suffix_none_returns_all() {
    let items = vec![
        make_pending("requestion.asked"),
        make_pending("permission.resolved"),
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
    assert!(requestions
        .read()
        .await
        .get_for_web("ses-1", "req-compat")
        .is_some());
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
