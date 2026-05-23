//! Demo seed: populate cache with synthetic requestion data.
//!
//! Only used when `--seed-demo` flag is passed. Injects a deterministic
//! set of requestions across two sessions so that `runtime_requestion_snapshot`
//! queries return meaningful data without requiring real upstream events.

use serde_json::json;
use tracing::info;

use osgp::SessionAddress;

use crate::cache::{RequestionCache, SessionStateCache};

/// Seed the caches with synthetic demo data.
///
/// Populates:
/// - 2 session states (`ses-alpha`, `ses-beta`)
/// - 5 pending requestions covering `requestion.asked`, `permission.asked`,
///   `question.asked`, `requestion.updated`, and one already-removed
///   (`requestion.resolved`) to demonstrate lifecycle.
pub fn seed_demo_data(
    session_cache: &mut SessionStateCache,
    requestion_cache: &mut RequestionCache,
) {
    info!("seeding demo data into caches");

    // ── Session states ──
    session_cache.upsert(
        "ses-alpha".into(),
        "busy".into(),
        json!({"sessionID": "ses-alpha", "state": "busy", "title": "Alpha session"}),
    );
    session_cache.upsert(
        "ses-beta".into(),
        "idle".into(),
        json!({"sessionID": "ses-beta", "state": "idle", "title": "Beta session"}),
    );

    // ── Pending requestions ──

    // 1. Pending requestion (asked)
    requestion_cache.upsert(
        "ses-alpha".into(),
        "req-deploy-1".into(),
        "Allow deployment to production".into(),
        SessionAddress::new(
            "domain-a",
            Some("runtime-alpha".into()),
            Some("ses-alpha".into()),
        ),
        "requestion.asked".into(),
        json!({
            "sessionID": "ses-alpha",
            "requestID": "req-deploy-1",
            "title": "Allow deployment to production",
            "type": "requestion.asked",
        }),
    );

    // 2. Pending permission (asked)
    requestion_cache.upsert(
        "ses-alpha".into(),
        "req-perm-1".into(),
        "Grant file system access".into(),
        SessionAddress::new(
            "domain-a",
            Some("runtime-alpha".into()),
            Some("ses-alpha".into()),
        ),
        "permission.asked".into(),
        json!({
            "sessionID": "ses-alpha",
            "requestID": "req-perm-1",
            "title": "Grant file system access",
            "type": "permission.asked",
        }),
    );

    // 3. Pending question (asked)
    requestion_cache.upsert(
        "ses-beta".into(),
        "req-question-1".into(),
        "Confirm action: delete stale cache?".into(),
        SessionAddress::new(
            "domain-a",
            Some("runtime-beta".into()),
            Some("ses-beta".into()),
        ),
        "question.asked".into(),
        json!({
            "sessionID": "ses-beta",
            "requestID": "req-question-1",
            "title": "Confirm action: delete stale cache?",
            "type": "question.asked",
        }),
    );

    // 4. Updated requestion
    requestion_cache.upsert(
        "ses-beta".into(),
        "req-update-1".into(),
        "Updated: change deployment target".into(),
        SessionAddress::new(
            "domain-a",
            Some("runtime-beta".into()),
            Some("ses-beta".into()),
        ),
        "requestion.updated".into(),
        json!({
            "sessionID": "ses-beta",
            "requestID": "req-update-1",
            "title": "Updated: change deployment target",
            "type": "requestion.updated",
        }),
    );

    // Note: we do NOT seed resolved/cancelled items — those are removed
    // from the cache by design. The demo can demonstrate the full lifecycle
    // by having the demo script emit:
    //   requestion.resolved → cache.remove() → snapshot count decreases

    info!(sessions = 2, requestions = 4, "demo data seeded");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_populates_expected_counts() {
        let mut session_cache = SessionStateCache::new();
        let mut requestion_cache = RequestionCache::new();

        seed_demo_data(&mut session_cache, &mut requestion_cache);

        assert!(session_cache.get_snapshot("ses-alpha").is_some());
        assert!(session_cache.get_snapshot("ses-beta").is_some());

        assert_eq!(requestion_cache.get_by_session("ses-alpha").len(), 2);
        assert_eq!(requestion_cache.get_by_session("ses-beta").len(), 2);
        assert_eq!(requestion_cache.get_all().len(), 4);
    }
}
