//! Permission queue tests.

use super::*;

fn op_read_routes() -> PermissionOp {
    PermissionOp::AdminRoutesRead
}

fn op_write_routes() -> PermissionOp {
    PermissionOp::AdminRoutesWrite
}

// ── Enqueue ──

#[test]
fn enqueue_creates_pending_request() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("peer-1".into(), op_read_routes());
    assert_eq!(id, "req-0");

    let pending = queue.pending();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, "req-0");
    assert_eq!(pending[0].peer_id, "peer-1");
    assert_eq!(pending[0].status, PermissionStatus::Pending);
}

#[test]
fn enqueue_increments_id() {
    let mut queue = PermissionQueue::default();
    let id0 = queue.enqueue("p".into(), op_read_routes());
    let id1 = queue.enqueue("p".into(), op_write_routes());
    assert_eq!(id0, "req-0");
    assert_eq!(id1, "req-1");
}

// ── Approve ──

#[test]
fn approve_pending_request() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("peer-1".into(), op_read_routes());
    assert!(queue.approve(&id, ApprovalKind::Persist));

    assert!(queue.pending().is_empty());
    assert_eq!(queue.all()[0].status, PermissionStatus::Approved);
}

#[test]
fn approve_nonexistent_returns_false() {
    let mut queue = PermissionQueue::default();
    assert!(!queue.approve("nobody", ApprovalKind::Once));
}

#[test]
fn approve_already_approved_returns_false() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("p".into(), op_read_routes());
    assert!(queue.approve(&id, ApprovalKind::Once));
    assert!(!queue.approve(&id, ApprovalKind::Once));
}

// ── Deny ──

#[test]
fn deny_pending_request() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("peer-1".into(), op_read_routes());
    assert!(queue.deny(&id));

    assert!(queue.pending().is_empty());
    assert_eq!(queue.all()[0].status, PermissionStatus::Denied);
}

#[test]
fn deny_nonexistent_returns_false() {
    let mut queue = PermissionQueue::default();
    assert!(!queue.deny("nobody"));
}

// ── Grants ──

#[test]
fn approve_creates_grant() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("peer-1".into(), op_read_routes());
    queue.approve(&id, ApprovalKind::Persist);

    assert!(queue.has_grant("peer-1", &op_read_routes()));
    let grant = queue.get_grant("peer-1", &op_read_routes()).unwrap();
    assert_eq!(grant.kind, ApprovalKind::Persist);
}

#[test]
fn no_grant_before_approval() {
    let mut queue = PermissionQueue::default();
    queue.enqueue("peer-1".into(), op_read_routes());
    assert!(!queue.has_grant("peer-1", &op_read_routes()));
}

#[test]
fn revoke_grant() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("peer-1".into(), op_read_routes());
    queue.approve(&id, ApprovalKind::Persist);
    assert!(queue.revoke_grant("peer-1", &op_read_routes()));
    assert!(!queue.has_grant("peer-1", &op_read_routes()));
}

#[test]
fn revoke_nonexistent_returns_false() {
    let mut queue = PermissionQueue::default();
    assert!(!queue.revoke_grant("peer-1", &op_read_routes()));
}

#[test]
fn list_grants() {
    let mut queue = PermissionQueue::default();
    let id1 = queue.enqueue("p1".into(), op_read_routes());
    let id2 = queue.enqueue("p2".into(), op_write_routes());
    queue.approve(&id1, ApprovalKind::Once);
    queue.approve(&id2, ApprovalKind::Persist);

    let grants = queue.list_grants();
    assert_eq!(grants.len(), 2);
}

// ── Revision ──

#[test]
fn revision_bumps_on_enqueue() {
    let mut queue = PermissionQueue::default();
    queue.enqueue("p".into(), op_read_routes());
    assert_eq!(queue.revision(), 1);
}

#[test]
fn revision_bumps_on_approve() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("p".into(), op_read_routes());
    queue.approve(&id, ApprovalKind::Once);
    assert_eq!(queue.revision(), 2);
}

#[test]
fn revision_bumps_on_deny() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("p".into(), op_read_routes());
    queue.deny(&id);
    assert_eq!(queue.revision(), 2);
}

#[test]
fn revision_bumps_on_revoke() {
    let mut queue = PermissionQueue::default();
    let id = queue.enqueue("p".into(), op_read_routes());
    queue.approve(&id, ApprovalKind::Persist);
    queue.revoke_grant("p", &op_read_routes());
    assert_eq!(queue.revision(), 3);
}

// ── PermissionOp ──

#[test]
fn permission_op_as_str_roundtrip() {
    let ops = [
        PermissionOp::ObserveSessionUpdate,
        PermissionOp::ReadRuntimeSessionMessages,
        PermissionOp::ControlAddPrompt,
        PermissionOp::AdminRoutesRead,
        PermissionOp::AdminRoutesWrite,
        PermissionOp::AdminRulesRead,
        PermissionOp::AdminRulesWrite,
        PermissionOp::AnnounceRoute,
    ];
    for op in &ops {
        let s = op.as_str();
        let parsed = PermissionOp::from_str(s);
        assert_eq!(parsed.as_ref(), Some(op), "roundtrip failed for: {s}");
    }
}

#[test]
fn permission_op_from_str_unknown() {
    assert!(PermissionOp::from_str("unknown.op").is_none());
}

// ── Serialization ──

#[test]
fn permission_request_serde_roundtrip() {
    let req = PermissionRequest {
        id: "req-0".into(),
        peer_id: "peer-1".into(),
        op: PermissionOp::AdminRoutesRead,
        status: PermissionStatus::Pending,
    };
    let json = serde_json::to_string(&req).unwrap();
    let de: PermissionRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(de.id, "req-0");
    assert_eq!(de.op, PermissionOp::AdminRoutesRead);
    assert_eq!(de.status, PermissionStatus::Pending);
}

#[test]
fn grant_record_serde_roundtrip() {
    let grant = GrantRecord {
        peer_id: "peer-1".into(),
        op: PermissionOp::AdminRoutesWrite,
        kind: ApprovalKind::Ttl { seconds: 600 },
    };
    let json = serde_json::to_string(&grant).unwrap();
    let de: GrantRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(de.kind, ApprovalKind::Ttl { seconds: 600 });
}
