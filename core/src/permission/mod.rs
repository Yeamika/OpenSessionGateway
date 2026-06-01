//! Permission request types for the admin/policy plane.
//!
//! Operations are abstracted as protocol-level op strings (not legacy
//! business concepts). The request lifecycle is:
//!
//! 1. A peer requests an op → `PermissionRequest` created with status `Pending`.
//! 2. Operator (via shell or admin handler) approves or denies.
//! 3. Approved requests may have a grant kind: `Once`, `Ttl`, or `Persist`.
//!
//! The `PermissionQueue` holds pending requests; approved/denied requests
//! are tracked separately for audit.

#[cfg(test)]
mod tests;
mod types;

pub use types::{
    ApprovalKind, GrantRecord, PermissionOp, PermissionRequest, PermissionStatus,
};

use std::collections::HashMap;

// ── PermissionQueue ─────────────────────────────────────────────────

/// A queue of pending permission requests with approval/denial support.
#[derive(Debug, Default)]
pub struct PermissionQueue {
    requests: Vec<PermissionRequest>,
    /// Active grants indexed by `(peer_id, op)`.
    grants: HashMap<(String, String), GrantRecord>,
    /// Monotonic counter for generating request IDs.
    next_id: u64,
    /// Revision counter (bumped on every mutation).
    revision: u64,
}

impl PermissionQueue {
    // ── Mutation ───────────────────────────────────────────────────

    /// Enqueue a new pending permission request. Returns the assigned ID.
    pub fn enqueue(&mut self, peer_id: String, op: PermissionOp) -> String {
        let id = format!("req-{}", self.next_id);
        self.next_id += 1;
        self.requests.push(PermissionRequest {
            id: id.clone(),
            peer_id,
            op,
            status: PermissionStatus::Pending,
        });
        self.bump_revision();
        id
    }

    /// Approve a pending request with a given approval kind.
    /// Returns `true` if found and approved.
    pub fn approve(&mut self, request_id: &str, kind: ApprovalKind) -> bool {
        let Some(req) = self.requests.iter_mut().find(|r| r.id == request_id) else {
            return false;
        };
        if req.status != PermissionStatus::Pending {
            return false;
        }
        req.status = PermissionStatus::Approved;

        // Record grant
        let grant = GrantRecord {
            peer_id: req.peer_id.clone(),
            op: req.op.clone(),
            kind: kind.clone(),
        };
        self.grants
            .insert((req.peer_id.clone(), req.op.as_str().to_string()), grant);

        self.bump_revision();
        true
    }

    /// Deny a pending request. Returns `true` if found and denied.
    pub fn deny(&mut self, request_id: &str) -> bool {
        let Some(req) = self.requests.iter_mut().find(|r| r.id == request_id) else {
            return false;
        };
        if req.status != PermissionStatus::Pending {
            return false;
        }
        req.status = PermissionStatus::Denied;
        self.bump_revision();
        true
    }

    // ── Query ──────────────────────────────────────────────────────

    /// List all pending requests.
    pub fn pending(&self) -> Vec<&PermissionRequest> {
        self.requests
            .iter()
            .filter(|r| r.status == PermissionStatus::Pending)
            .collect()
    }

    /// List all requests (any status).
    pub fn all(&self) -> &[PermissionRequest] {
        &self.requests
    }

    /// Check if a peer has an active grant for an op.
    pub fn has_grant(&self, peer_id: &str, op: &PermissionOp) -> bool {
        self.grants
            .contains_key(&(peer_id.to_string(), op.as_str().to_string()))
    }

    /// Get the grant record for a peer+op, if any.
    pub fn get_grant(&self, peer_id: &str, op: &PermissionOp) -> Option<&GrantRecord> {
        self.grants
            .get(&(peer_id.to_string(), op.as_str().to_string()))
    }

    /// Revoke a grant. Returns `true` if it existed.
    pub fn revoke_grant(&mut self, peer_id: &str, op: &PermissionOp) -> bool {
        let removed = self
            .grants
            .remove(&(peer_id.to_string(), op.as_str().to_string()));
        if removed.is_some() {
            self.bump_revision();
        }
        removed.is_some()
    }

    /// List all active grants.
    pub fn list_grants(&self) -> Vec<&GrantRecord> {
        self.grants.values().collect()
    }

    /// Current revision.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn bump_revision(&mut self) {
        self.revision = self.revision.wrapping_add(1);
    }
}
