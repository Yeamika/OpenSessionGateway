//! Cache module for session state and requestion tracking.
//!
//! Pure-function caches for:
//! - **Session state** — populated from `session_update` envelopes
//! - **Pending requestions** — populated from `requestion.asked`, `permission.asked`,
//!   `question.asked` envelopes (OSGP unified requestion model)

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

use osgp::SessionAddress;

// ── Timestamp helper ────────────────────────────────────────────────

/// Produce a compact unix-epoch timestamp string (`secs.millis`).
///
/// Named to avoid implying a `chrono` dependency.
fn epoch_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", duration.as_secs(), duration.subsec_millis())
}

// ── Session State Cache ─────────────────────────────────────────────

/// Cached session state from `session_update` envelopes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_id: String,
    pub state: String,
    pub payload: Value,
    pub updated_at: String,
}

/// In-memory cache of session states, keyed by `session_id`.
#[derive(Debug)]
pub struct SessionStateCache {
    entries: HashMap<String, SessionState>,
}

impl SessionStateCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Insert or replace a session state entry.
    pub fn upsert(&mut self, session_id: String, state: String, payload: Value) {
        let now = epoch_timestamp();
        self.entries.insert(
            session_id.clone(),
            SessionState {
                session_id,
                state,
                payload,
                updated_at: now,
            },
        );
    }

    /// Get a session state snapshot by `session_id`.
    pub fn get_snapshot(&self, session_id: &str) -> Option<&SessionState> {
        self.entries.get(session_id)
    }

    /// Number of tracked sessions (test-only).
    pub fn len_for_web(&self) -> usize {
        self.entries.len()
    }

    /// Number of tracked sessions (test-only).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.len_for_web()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ── Requestion Cache ────────────────────────────────────────────────

/// A pending requestion, permission, or question.
///
/// `event_subtype` stores the normalized requestion event label, for example
/// `"requestion.asked"`, for OSGP unified requestion semantics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingRequestion {
    pub session_id: String,
    pub request_id: String,
    pub title: String,
    pub source: SessionAddress,
    /// Normalized event subtype, e.g. `"requestion.asked"`.
    pub event_subtype: String,
    pub payload: Value,
    pub updated_at: String,
}

/// In-memory cache of pending requestions, keyed by `(session_id, request_id)`.
#[derive(Debug)]
pub struct RequestionCache {
    /// Outer key: session_id, inner key: request_id.
    entries: HashMap<String, HashMap<String, PendingRequestion>>,
}

impl RequestionCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Insert or replace a pending requestion.
    pub fn upsert(
        &mut self,
        session_id: String,
        request_id: String,
        title: String,
        source: SessionAddress,
        event_subtype: String,
        payload: Value,
    ) {
        let now = epoch_timestamp();
        let session_entries = self.entries.entry(session_id.clone()).or_default();
        session_entries.insert(
            request_id.clone(),
            PendingRequestion {
                session_id,
                request_id,
                title,
                source,
                event_subtype,
                payload,
                updated_at: now,
            },
        );
    }

    /// Remove a requestion (on resolved/cancelled).
    /// Also removes the session bucket if it becomes empty.
    pub fn remove(&mut self, session_id: &str, request_id: &str) {
        if let Some(session_entries) = self.entries.get_mut(session_id) {
            session_entries.remove(request_id);
            if session_entries.is_empty() {
                self.entries.remove(session_id);
            }
        }
    }

    /// Get all pending requestions for a given session.
    pub fn get_by_session(&self, session_id: &str) -> Vec<&PendingRequestion> {
        self.entries
            .get(session_id)
            .map(|m| m.values().collect())
            .unwrap_or_default()
    }

    /// Get a specific requestion by session + request id (test-only).
    pub fn get_for_web(&self, session_id: &str, request_id: &str) -> Option<&PendingRequestion> {
        self.entries.get(session_id).and_then(|m| m.get(request_id))
    }

    /// Get a specific requestion by session + request id (test-only).
    #[cfg(test)]
    pub fn get(&self, session_id: &str, request_id: &str) -> Option<&PendingRequestion> {
        self.get_for_web(session_id, request_id)
    }

    /// Get all requestions across all sessions.
    pub fn get_all(&self) -> Vec<&PendingRequestion> {
        self.entries.values().flat_map(|m| m.values()).collect()
    }

    /// Group pending requestions by session for web/API callers.
    pub fn grouped_by_session_for_web(&self) -> BTreeMap<String, Vec<PendingRequestion>> {
        self.entries
            .iter()
            .map(|(session_id, entries)| {
                let mut items = entries.values().cloned().collect::<Vec<_>>();
                items.sort_by(|a, b| a.request_id.cmp(&b.request_id));
                (session_id.clone(), items)
            })
            .collect()
    }

    /// Total number of pending requestions across all sessions (test-only).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.values().map(|m| m.len()).sum()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.values().all(|m| m.is_empty())
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn session_cache_upsert_and_get() {
        let mut cache = SessionStateCache::new();
        assert!(cache.is_empty());

        cache.upsert("ses-1".into(), "busy".into(), json!({"key": "value"}));
        assert_eq!(cache.len(), 1);

        let state = cache.get_snapshot("ses-1").unwrap();
        assert_eq!(state.session_id, "ses-1");
        assert_eq!(state.state, "busy");

        // Upsert overwrites
        cache.upsert("ses-1".into(), "idle".into(), json!({"key": "updated"}));
        assert_eq!(cache.len(), 1);
        let state = cache.get_snapshot("ses-1").unwrap();
        assert_eq!(state.state, "idle");
    }

    #[test]
    fn requestion_cache_upsert_and_get() {
        let mut cache = RequestionCache::new();
        assert!(cache.is_empty());

        cache.upsert(
            "ses-1".into(),
            "req-1".into(),
            "Permission Required".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );
        assert_eq!(cache.len(), 1);

        let r = cache.get("ses-1", "req-1").unwrap();
        assert_eq!(r.session_id, "ses-1");
        assert_eq!(r.request_id, "req-1");
        assert_eq!(r.title, "Permission Required");
    }

    #[test]
    fn requestion_cache_remove() {
        let mut cache = RequestionCache::new();
        cache.upsert(
            "ses-1".into(),
            "req-1".into(),
            "A".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );
        cache.upsert(
            "ses-1".into(),
            "req-2".into(),
            "B".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "permission.asked".into(),
            json!({}),
        );
        assert_eq!(cache.len(), 2);

        cache.remove("ses-1", "req-1");
        assert_eq!(cache.len(), 1);
        assert!(cache.get("ses-1", "req-1").is_none());
        assert!(cache.get("ses-1", "req-2").is_some());
    }

    #[test]
    fn requestion_cache_remove_last_empties_session_bucket() {
        let mut cache = RequestionCache::new();
        cache.upsert(
            "ses-1".into(),
            "req-1".into(),
            "A".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );

        cache.remove("ses-1", "req-1");
        assert_eq!(cache.len(), 0);
        assert!(cache.get_by_session("ses-1").is_empty());
    }

    #[test]
    fn requestion_cache_get_by_session() {
        let mut cache = RequestionCache::new();
        cache.upsert(
            "ses-1".into(),
            "req-1".into(),
            "A".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );
        cache.upsert(
            "ses-1".into(),
            "req-2".into(),
            "B".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "permission.asked".into(),
            json!({}),
        );
        cache.upsert(
            "ses-2".into(),
            "req-3".into(),
            "C".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-2".into())),
            "question.asked".into(),
            json!({}),
        );

        assert_eq!(cache.get_by_session("ses-1").len(), 2);
        assert_eq!(cache.get_by_session("ses-2").len(), 1);
    }

    #[test]
    fn requestion_cache_groups_by_session_for_web() {
        let mut cache = RequestionCache::new();
        cache.upsert(
            "ses-1".into(),
            "req-b".into(),
            "B".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );
        cache.upsert(
            "ses-1".into(),
            "req-a".into(),
            "A".into(),
            SessionAddress::new("domain-a", Some("runtime-a".into()), Some("ses-1".into())),
            "requestion.asked".into(),
            json!({}),
        );

        let grouped = cache.grouped_by_session_for_web();
        assert_eq!(grouped["ses-1"].len(), 2);
        assert_eq!(grouped["ses-1"][0].request_id, "req-a");
    }
}
