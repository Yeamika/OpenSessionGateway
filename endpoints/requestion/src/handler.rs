//! Envelope and ReadRequest handlers for the requestion endpoint.
//!
//! ## Read-path unification
//!
//! Both `RequestionSnapshot` (compat alias) and `RuntimeRequestionSnapshot`
//! (canonical) are handled by a single internal function that always produces
//! the canonical `"runtime_requestion_snapshot"` response subtype.
//!
//! ## Address model
//!
//! - Responses use `source` = this endpoint's address, `target` = request's `source`.
//! - Routing is address-based; web/API callers reply to the original source address.

#![allow(deprecated)] // protocol crate deprecated old ReadOperation variants

use std::sync::Arc;

use futures_util::SinkExt;
use osgp::{LinkMessage, ReadOperation, ReadRequest, ReadResponse, SessionAddress};
use serde_json::Value;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::cache::{PendingRequestion, RequestionCache, SessionStateCache};
use crate::cli::{format_address, CliConfig};

/// WebSocket writer type alias.
type WsWriter = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

/// Canonical response subtype for the unified requestion snapshot.
const RESPONSE_SUBTYPE: &str = "runtime_requestion_snapshot";

// ── Envelope handler ────────────────────────────────────────────────

/// Process an incoming envelope and update the caches.
///
/// OSGP unified requestion model: `permission.asked` and `question.asked`
/// are treated as requestion items in the cache.
pub async fn handle_envelope(
    envelope: &osgp::SessionEnvelope,
    session_cache: &Arc<RwLock<SessionStateCache>>,
    requestion_cache: &Arc<RwLock<RequestionCache>>,
) {
    let event_subtype = requestion_event_subtype(envelope);
    let payload = &envelope.payload;

    match event_subtype.as_str() {
        "session_update" => {
            let session_id = extract_any_field(payload, &["sessionID", "sessionId"]);
            let state = extract_field(payload, "state");

            if !session_id.is_empty() {
                let state = if state.is_empty() {
                    "unknown".into()
                } else {
                    state
                };
                let mut cache = session_cache.write().await;
                cache.upsert(session_id.clone(), state.clone(), payload.clone());
                info!(session_id, state, "updated session state cache");
                println!("[session_update] session_id={session_id} state={state}");
            }
        }
        "requestion.asked" => {
            let session_id = session_id_from_payload_or_source(payload, &envelope.source);
            let request_id =
                extract_any_field(payload, &["requestID", "requestId", "requestionId"]);
            let title = extract_any_field(payload, &["title", "prompt", "question"]);

            if !session_id.is_empty() && !request_id.is_empty() {
                let mut cache = requestion_cache.write().await;
                cache.upsert(
                    session_id.clone(),
                    request_id.clone(),
                    title.clone(),
                    envelope.source.clone(),
                    event_subtype.clone(),
                    payload.clone(),
                );
                info!(
                    session_id,
                    request_id, title, event_subtype, "upserted pending requestion"
                );
                println!("[{event_subtype}] session_id={session_id} request_id={request_id} title={title}");
            }
        }
        "requestion.resolved" | "requestion.cancelled" => {
            let session_id = session_id_from_payload_or_source(payload, &envelope.source);
            let request_id =
                extract_any_field(payload, &["requestID", "requestId", "requestionId"]);

            if !session_id.is_empty() && !request_id.is_empty() {
                let mut cache = requestion_cache.write().await;
                cache.remove(&session_id, &request_id);
                info!(session_id, request_id, event_subtype, "removed from cache");
                println!(
                    "[{event_subtype}] session_id={session_id} request_id={request_id} removed"
                );
            }
        }
        "requestion.updated" => {
            let session_id = session_id_from_payload_or_source(payload, &envelope.source);
            let request_id =
                extract_any_field(payload, &["requestID", "requestId", "requestionId"]);
            let title = extract_any_field(payload, &["title", "prompt", "question"]);

            if !session_id.is_empty() && !request_id.is_empty() {
                let mut cache = requestion_cache.write().await;
                cache.upsert(
                    session_id.clone(),
                    request_id.clone(),
                    title.clone(),
                    envelope.source.clone(),
                    event_subtype.clone(),
                    payload.clone(),
                );
                debug!(session_id, request_id, event_subtype, "merged into cache");
            }
        }
        _ => {
            debug!(event_subtype, "ignoring envelope subtype");
        }
    }
}

// ── ReadRequest handler ─────────────────────────────────────────────

/// Handle a ReadRequest — respond with cached view data.
///
/// Only answers requests whose target address matches this endpoint's
/// own address.  The response `source` is set to this endpoint's address,
/// and `target` is set to the request's `source` (reply-to).
pub async fn handle_read_request(
    request: &ReadRequest,
    session_cache: &Arc<RwLock<SessionStateCache>>,
    requestion_cache: &Arc<RwLock<RequestionCache>>,
    writer: &mut WsWriter,
    config: &CliConfig,
) {
    let op_name = request.operation.op_name();
    info!(
        request_id = %request.request_id,
        op = op_name,
        target_domain = %request.target.domain,
        "received ReadRequest"
    );

    if !address_matches_self(&request.target, config) {
        debug!(
            target = %format_address(&request.target),
            self_addr = %format_address(&config.address),
            "ReadRequest not addressed to us, ignoring"
        );
        return;
    }

    let response =
        build_read_response(request, session_cache, requestion_cache, &config.address).await;

    let response_text =
        serde_json::to_string(&LinkMessage::ReadResponse(response.clone())).unwrap_or_default();
    if let Err(e) = writer.send(Message::Text(response_text.into())).await {
        warn!(error = %e, "failed to send ReadResponse");
    } else {
        info!(
            request_id = %request.request_id,
            status = ?response.status,
            subtype = %response.subtype,
            "sent ReadResponse"
        );
        println!(
            "[ReadResponse] request_id={} subtype={} status={:?}",
            request.request_id, response.subtype, response.status
        );
    }
}

// ── Internal helpers ────────────────────────────────────────────────

/// Build a ReadResponse from cached data based on the operation type.
///
/// Uses `ReadResponse::ok_for_request` / `error_for_request` which
/// automatically sets `source` = `self_address`, `target` = `request.source`.
async fn build_read_response(
    request: &ReadRequest,
    session_cache: &Arc<RwLock<SessionStateCache>>,
    requestion_cache: &Arc<RwLock<RequestionCache>>,
    self_address: &SessionAddress,
) -> ReadResponse {
    match &request.operation {
        ReadOperation::SessionUpdateSnapshot { session_id } => {
            let cache = session_cache.read().await;
            match cache.get_snapshot(&session_id.0) {
                Some(data) => ReadResponse::ok_for_request(
                    self_address,
                    request,
                    serde_json::json!({
                        "sessionID": session_id.0,
                        "sessionUpdate": data,
                        "_source": "endpoint-cache",
                    }),
                ),
                None => ReadResponse::not_found_for_request(
                    self_address,
                    request,
                    format!("session {} not found in endpoint cache", session_id.0),
                ),
            }
        }

        // ── Compat alias: RequestionSnapshot → unified runtime_requestion_snapshot ──
        ReadOperation::RequestionSnapshot { session_id, status } => {
            let cache = requestion_cache.read().await;
            let items = cache.get_by_session(&session_id.0);
            build_runtime_requestion_response(
                self_address,
                request,
                None,
                Some(&session_id.0),
                status.as_deref(),
                items,
            )
        }

        // ── Canonical: RuntimeRequestionSnapshot ──
        ReadOperation::RuntimeRequestionSnapshot {
            runtime_id,
            session_id,
            status,
            blocking: _,
        } => {
            let cache = requestion_cache.read().await;
            let items: Vec<&PendingRequestion> = match session_id {
                Some(sid) => cache.get_by_session(&sid.0),
                None => cache.get_all(),
            };
            build_runtime_requestion_response(
                self_address,
                request,
                Some(runtime_id.as_str()),
                session_id.as_ref().map(|sid| sid.0.as_str()),
                status.as_deref(),
                items,
            )
        }

        ReadOperation::SessionViewSnapshot {
            session_id,
            requestion_status,
        } => {
            let session_guard = session_cache.read().await;
            let requestion_guard = requestion_cache.read().await;

            let session_state = session_guard.get_snapshot(&session_id.0);
            let all = requestion_guard.get_by_session(&session_id.0);
            let filtered = filter_by_suffix(all, requestion_status.as_deref());

            ReadResponse::ok_for_request(
                self_address,
                request,
                serde_json::json!({
                    "sessionID": session_id.0,
                    "sessionUpdate": session_state,
                    "requestions": filtered,
                    "requestionCount": filtered.len(),
                    "_source": "endpoint-cache",
                }),
            )
        }
        _ => ReadResponse::error_for_request(
            self_address,
            request,
            format!(
                "operation {} not supported by requestion-endpoint",
                request.operation.op_name()
            ),
        ),
    }
}

/// Build a unified `runtime_requestion_snapshot` response.
///
/// Uses `ReadResponse::new` with canonical subtype override because
/// the request may use a compat operation whose subtype differs from
/// the canonical `runtime_requestion_snapshot`.
///
/// Addressing:
/// - `source` = `self_address` (this endpoint)
/// - `target` = `request.source` (reply-to the requestor)
fn build_runtime_requestion_response<'a>(
    self_address: &SessionAddress,
    request: &ReadRequest,
    runtime_id: Option<&str>,
    session_id: Option<&str>,
    status: Option<&str>,
    items: Vec<&'a PendingRequestion>,
) -> ReadResponse {
    let filtered = filter_by_suffix(items, status);

    let mut payload = serde_json::json!({
        "requestions": filtered,
        "count": filtered.len(),
        "_source": "endpoint-cache",
    });

    if let Some(rt) = runtime_id {
        payload["runtimeID"] = Value::String(rt.to_string());
    }
    if let Some(sid) = session_id {
        payload["sessionID"] = Value::String(sid.to_string());
    }

    ReadResponse::new(
        self_address.clone(),
        request.source.clone(),
        RESPONSE_SUBTYPE,
        &request.request_id,
        &request.trace_id,
        osgp::ResponseStatus::Ok,
        payload,
    )
}

/// Extract a string field from a JSON payload, returning `""` on missing.
fn extract_field(payload: &Value, field: &str) -> String {
    payload
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn extract_any_field(payload: &Value, fields: &[&str]) -> String {
    fields
        .iter()
        .find_map(|field| payload.get(*field).and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

fn session_id_from_payload_or_source(payload: &Value, source: &SessionAddress) -> String {
    let session_id = extract_any_field(payload, &["sessionID", "sessionId"]);
    if session_id.is_empty() {
        source.session.clone().unwrap_or_default()
    } else {
        session_id
    }
}

fn requestion_event_subtype(envelope: &osgp::SessionEnvelope) -> String {
    if envelope.link_type == "upload" {
        return match envelope.subtype.as_str() {
            "requestion_asked" => "requestion.asked".into(),
            "requestion_updated" => "requestion.updated".into(),
            "requestion_resolved" => "requestion.resolved".into(),
            "requestion_cancelled" => "requestion.cancelled".into(),
            "session_update" => "session_update".into(),
            other => other.into(),
        };
    }
    compat_event_subtype(envelope)
}

fn compat_event_subtype(envelope: &osgp::SessionEnvelope) -> String {
    envelope
        .payload
        .get("eventSubtype")
        .and_then(|v| v.as_str())
        .unwrap_or(envelope.subtype.as_str())
        .to_string()
}

/// Filter requestions by status suffix (e.g. `"asked"`, `"resolved"`).
fn filter_by_suffix<'a>(
    items: Vec<&'a PendingRequestion>,
    status: Option<&str>,
) -> Vec<&'a PendingRequestion> {
    match status {
        Some(filter) => items
            .into_iter()
            .filter(|r| r.event_subtype.ends_with(&format!(".{filter}")))
            .collect(),
        None => items,
    }
}

/// Check whether a target address is addressed to this endpoint.
fn address_matches_self(target: &SessionAddress, config: &CliConfig) -> bool {
    let self_addr = &config.address;
    if target.domain == self_addr.domain
        && target.runtime == self_addr.runtime
        && target.session == self_addr.session
    {
        return true;
    }
    // Domain-only broadcast target (no runtime/session specified).
    if target.domain == self_addr.domain && target.runtime.is_none() && target.session.is_none() {
        return true;
    }
    false
}

#[cfg(test)]
#[path = "handler_tests.rs"]
mod handler_tests;
