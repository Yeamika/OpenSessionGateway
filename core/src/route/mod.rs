//! Route table, next-hop selection, and split-horizon announcement management.
//!
//! Uses `osgp::SessionAddress` as the route key type. The table
//! supports multi-path routing (multiple entries per address) and resolves
//! the lowest-distance next-hop, optionally avoiding a specific neighbor
//! (split horizon).
//!
//! Route entries carry an [`RouteOrigin`] tag so learned routes (from peer
//! announcements) can be distinguished from manual routes (admin-inserted).
//! `remove_neighbor` only removes learned routes; manual routes survive
//! peer disconnect.

#[cfg(test)]
mod tests;
mod types;

use std::collections::HashMap;

use osgp::{SessionAddress, SessionEnvelope};

pub use types::{ForwardDecision, NextHop, RouteAnnouncement, RouteOrigin, RouteSnapshotEntry};
use types::{RouteBucket, RouteEntry};

// ── RouteTable ──────────────────────────────────────────────────────

/// The core route table that maps `SessionAddress` keys to one or more
/// `RouteEntry` candidates. Resolution picks the entry with the lowest
/// distance, optionally avoiding a specific neighbor (split horizon).
///
/// For session-level addresses, automatically creates a runtime-level
/// fallback entry when inserting announcements.
#[derive(Debug, Default, Clone)]
pub struct RouteTable {
    routes: HashMap<String, RouteBucket>,
    revision: u64,
}

impl RouteTable {
    // ── Simple upsert (backward-compatible) ────────────────────────

    /// Insert or update a route. Only updates if the new distance is
    /// strictly lower than the existing entry for the same neighbor.
    /// Routes inserted via this method are marked as [`RouteOrigin::Learned`].
    pub fn upsert(&mut self, address: SessionAddress, neighbor: impl Into<String>, distance: u32) {
        let candidate = RouteEntry {
            neighbor: neighbor.into(),
            distance,
            origin: RouteOrigin::Learned,
        };
        let key = address_key(&address);
        match self.routes.get(&key) {
            Some(bucket)
                if bucket
                    .entries
                    .first()
                    .is_some_and(|e| e.distance <= candidate.distance) => {}
            _ => {
                self.routes.insert(
                    key,
                    RouteBucket {
                        address,
                        entries: vec![candidate],
                    },
                );
                self.bump_revision();
            }
        }
    }

    // ── Multi-path upsert ──────────────────────────────────────────

    /// Insert or update routes announced by a neighbor. Returns `true` if the
    /// table actually changed (new entry or updated distance).
    ///
    /// For session-level addresses, automatically creates a runtime-level
    /// fallback entry as well. Entries are marked as [`RouteOrigin::Learned`].
    pub fn upsert_announcement(
        &mut self,
        announcement: &RouteAnnouncement,
        neighbor: impl Into<String>,
    ) -> bool {
        let neighbor = neighbor.into();
        let mut changed = self.upsert_entry(
            announcement.address.clone(),
            RouteEntry {
                neighbor: neighbor.clone(),
                distance: announcement.distance.saturating_add(1),
                origin: RouteOrigin::Learned,
            },
        );

        // Auto-create runtime-level fallback for session-level announcements.
        if announcement.address.session.is_some() && announcement.address.runtime.is_some() {
            let runtime_address = SessionAddress {
                domain: announcement.address.domain.clone(),
                runtime: announcement.address.runtime.clone(),
                session: None,
            };
            changed |= self.upsert_entry(
                runtime_address,
                RouteEntry {
                    neighbor,
                    distance: announcement.distance.saturating_add(1),
                    origin: RouteOrigin::Learned,
                },
            );
        }

        if changed {
            self.bump_revision();
        }
        changed
    }

    fn upsert_entry(&mut self, address: SessionAddress, entry: RouteEntry) -> bool {
        let key = address_key(&address);
        let bucket = self.routes.entry(key).or_insert(RouteBucket {
            address,
            entries: Vec::new(),
        });

        if let Some(existing) = bucket
            .entries
            .iter_mut()
            .find(|e| e.neighbor == entry.neighbor && e.origin == entry.origin)
        {
            if existing.distance == entry.distance {
                return false;
            }
            existing.distance = entry.distance;
            true
        } else {
            bucket.entries.push(entry);
            true
        }
    }

    // ── Manual route management (admin plane) ──────────────────────

    /// Insert a manual route. Returns `true` if the table changed.
    pub fn insert_manual(
        &mut self,
        address: SessionAddress,
        neighbor: impl Into<String>,
        distance: u32,
    ) -> bool {
        let changed = self.upsert_entry(
            address,
            RouteEntry {
                neighbor: neighbor.into(),
                distance,
                origin: RouteOrigin::Manual,
            },
        );
        if changed {
            self.bump_revision();
        }
        changed
    }

    /// Remove a specific manual route entry. Returns `true` if removed.
    pub fn remove_manual(
        &mut self,
        address: &SessionAddress,
        neighbor: &str,
    ) -> bool {
        let key = address_key(address);
        let mut changed = false;
        if let Some(bucket) = self.routes.get_mut(&key) {
            let before = bucket.entries.len();
            bucket
                .entries
                .retain(|e| !(e.neighbor == neighbor && e.origin == RouteOrigin::Manual));
            changed = bucket.entries.len() != before;
            if bucket.entries.is_empty() {
                self.routes.remove(&key);
            }
        }
        if changed {
            self.bump_revision();
        }
        changed
    }

    // ── Remove routes ──────────────────────────────────────────────

    /// Remove all **learned** routes from a specific neighbor.
    /// Manual routes for this neighbor are preserved.
    /// Returns `true` if any entries were actually removed.
    pub fn remove_neighbor(&mut self, neighbor_id: &str) -> bool {
        let before = self.entry_count();
        self.routes.retain(|_, bucket| {
            bucket
                .entries
                .retain(|e| !(e.neighbor == neighbor_id && e.origin == RouteOrigin::Learned));
            !bucket.entries.is_empty()
        });
        let changed = before != self.entry_count();
        if changed {
            self.bump_revision();
        }
        changed
    }

    // ── Semantic list (admin plane) ────────────────────────────────

    /// Snapshot all routes with origin metadata.
    pub fn list_all(&self) -> Vec<RouteSnapshotEntry> {
        let mut result = Vec::new();
        for bucket in self.routes.values() {
            for entry in &bucket.entries {
                result.push(RouteSnapshotEntry {
                    address: bucket.address.clone(),
                    neighbor: entry.neighbor.clone(),
                    distance: entry.distance,
                    origin: entry.origin,
                });
            }
        }
        result.sort_by(|a, b| {
            address_key(&a.address)
                .cmp(&address_key(&b.address))
                .then(a.neighbor.cmp(&b.neighbor))
        });
        result
    }

    /// Snapshot routes for a specific neighbor.
    pub fn list_by_neighbor(&self, neighbor: &str) -> Vec<RouteSnapshotEntry> {
        self.list_all()
            .into_iter()
            .filter(|e| e.neighbor == neighbor)
            .collect()
    }

    /// Snapshot only manual routes.
    pub fn list_manual(&self) -> Vec<RouteSnapshotEntry> {
        self.list_all()
            .into_iter()
            .filter(|e| e.origin == RouteOrigin::Manual)
            .collect()
    }

    // ── Resolve ────────────────────────────────────────────────────

    /// Resolve the best next-hop for a target address (simple API).
    pub fn decide(&self, envelope: &SessionEnvelope) -> ForwardDecision {
        self.decide_for_target(&envelope.target, None)
    }

    /// Resolve the best next-hop for a target address, with optional
    /// neighbor avoidance (split horizon).
    pub fn decide_for_target(
        &self,
        target: &SessionAddress,
        avoid_neighbor: Option<&str>,
    ) -> ForwardDecision {
        let entry = self
            .best_for_key(&address_key(target), avoid_neighbor)
            .or_else(|| runtime_key(target).and_then(|key| self.best_for_key(&key, avoid_neighbor)))
            .or_else(|| self.best_for_key(&domain_key(target), avoid_neighbor));

        match entry {
            Some(entry) => ForwardDecision {
                next_hop: NextHop::Neighbor(entry.neighbor.clone()),
            },
            None => ForwardDecision {
                next_hop: NextHop::Drop("no route for target".to_string()),
            },
        }
    }

    fn best_for_key(&self, key: &str, avoid: Option<&str>) -> Option<&RouteEntry> {
        self.routes.get(key).and_then(|bucket| {
            bucket
                .entries
                .iter()
                .filter(|e| avoid.is_none_or(|a| e.neighbor != a))
                .min_by_key(|e| e.distance)
        })
    }

    // ── Export ─────────────────────────────────────────────────────

    /// Export best routes for split-horizon announcement, excluding
    /// routes learned from the given neighbor.
    pub fn export_announcements_excluding(
        &self,
        avoid_neighbor: Option<&str>,
    ) -> Vec<RouteAnnouncement> {
        let mut rows: Vec<RouteAnnouncement> = self
            .routes
            .values()
            .filter_map(|bucket| {
                bucket
                    .entries
                    .iter()
                    .filter(|e| avoid_neighbor.is_none_or(|a| e.neighbor != a))
                    .min_by_key(|e| e.distance)
                    .map(|entry| RouteAnnouncement {
                        address: bucket.address.clone(),
                        distance: entry.distance,
                    })
            })
            .collect();
        rows.sort_by(|a, b| address_key(&a.address).cmp(&address_key(&b.address)));
        rows.dedup_by(|a, b| address_key(&a.address) == address_key(&b.address));
        rows
    }

    /// Export all best routes (no split-horizon avoidance).
    pub fn export_announcements(&self) -> Vec<RouteAnnouncement> {
        self.export_announcements_excluding(None)
    }

    // ── Snapshot ───────────────────────────────────────────────────

    /// Snapshot the full route table for diagnostics.
    pub fn snapshot(&self) -> Vec<(String, Vec<(String, u32)>)> {
        let mut rows: Vec<_> = self
            .routes
            .iter()
            .map(|(key, bucket)| {
                let mut entries: Vec<_> = bucket
                    .entries
                    .iter()
                    .map(|e| (e.neighbor.clone(), e.distance))
                    .collect();
                entries.sort_by_key(|(_, d)| *d);
                (key.clone(), entries)
            })
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        rows
    }

    // ── Revision ───────────────────────────────────────────────────

    /// Current revision counter. Bumped on every mutation.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn bump_revision(&mut self) {
        self.revision = self.revision.wrapping_add(1);
    }

    fn entry_count(&self) -> usize {
        self.routes.values().map(|b| b.entries.len()).sum()
    }
}

// ── SessionAddress key helpers ──────────────────────────────────────

/// Full key: domain/runtime/session.
pub fn address_key(addr: &SessionAddress) -> String {
    format!(
        "{}/{}/{}",
        addr.domain,
        addr.runtime.as_deref().unwrap_or("*"),
        addr.session.as_deref().unwrap_or("*"),
    )
}

/// Runtime-level key: domain/runtime/*  (returns None if no runtime).
pub fn runtime_key(addr: &SessionAddress) -> Option<String> {
    addr.runtime
        .as_ref()
        .map(|rt| format!("{}/{}/{}", addr.domain, rt, "*"))
}

/// Domain-level key: domain/*/*.
pub fn domain_key(addr: &SessionAddress) -> String {
    format!("{}/{}/{}", addr.domain, "*", "*")
}
