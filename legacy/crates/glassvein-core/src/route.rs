//! Route table, next-hop selection, and route announcement management.
//!
//! This module contains the core routing data structures that are
//! transport-independent. The route table resolves `RouteAddress` to
//! `NextHop` using shortest-distance selection with split-horizon support.

use std::collections::HashMap;

use glassvein_protocol::{RouteAddress, RouteAnnouncement};

// ── NextHop ─────────────────────────────────────────────────────────

/// Identifies where a route points: either a directly-connected peer
/// (downstream client/router) or an upstream router connection.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum NextHop {
    Peer(String),
    Upstream(String),
}

// ── ForwardAction ───────────────────────────────────────────────────

/// Legacy forward action. Retained for backward compatibility with
/// `glassvein-router`. New code should prefer [`ForwardPlan`](crate::ForwardPlan).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForwardAction {
    DeliverPeer { peer_id: String },
    ForwardUpstream { upstream_id: String },
    Drop { reason: String },
}

// ── RouteEntry ──────────────────────────────────────────────────────

/// A single route entry: which next-hop to use and how many hops away.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteEntry {
    pub hop: NextHop,
    pub distance: u16,
}

// ── RouteBucket (internal) ──────────────────────────────────────────

#[derive(Clone, Debug)]
struct RouteBucket {
    address: RouteAddress,
    entries: Vec<RouteEntry>,
}

// ── RouteTable ──────────────────────────────────────────────────────

/// The core route table that maps `RouteAddress` keys to one or more
/// `RouteEntry` candidates. Resolution picks the entry with the lowest
/// distance, optionally avoiding a specific next-hop (split horizon).
#[derive(Clone, Debug, Default)]
pub struct RouteTable {
    routes: HashMap<String, RouteBucket>,
}

impl RouteTable {
    /// Insert or update routes announced by a neighbor. Returns `true` if the
    /// table actually changed (new entry or updated distance).
    ///
    /// For session-level announcements, automatically creates a runtime-level
    /// fallback entry as well.
    pub fn upsert_announcement(&mut self, announcement: &RouteAnnouncement, hop: NextHop) -> bool {
        let mut changed = self.upsert_exact(
            announcement.address.clone(),
            RouteEntry {
                hop: hop.clone(),
                distance: announcement.distance.saturating_add(1),
            },
        );

        if announcement.address.session_id.is_some() {
            if let Some(runtime_key) = announcement.address.runtime_key() {
                let runtime_address = RouteAddress {
                    domain_id: announcement.address.domain_id.clone(),
                    runtime_id: announcement.address.runtime_id.clone(),
                    session_id: None,
                };
                changed |= self.upsert_key(
                    runtime_key,
                    runtime_address,
                    RouteEntry {
                        hop,
                        distance: announcement.distance.saturating_add(1),
                    },
                );
            }
        }

        changed
    }

    fn upsert_exact(&mut self, address: RouteAddress, entry: RouteEntry) -> bool {
        self.upsert_key(address.key(), address, entry)
    }

    fn upsert_key(&mut self, key: String, address: RouteAddress, entry: RouteEntry) -> bool {
        let bucket = self.routes.entry(key).or_insert(RouteBucket {
            address,
            entries: Vec::new(),
        });

        if let Some(existing) = bucket
            .entries
            .iter_mut()
            .find(|existing| existing.hop == entry.hop)
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

    /// Remove all routes learned from a specific peer. Returns `true` if
    /// any entries were actually removed.
    pub fn remove_peer(&mut self, peer_id: &str) -> bool {
        let before = self.route_entry_count();
        self.routes.retain(|_, bucket| {
            bucket
                .entries
                .retain(|entry| !matches!(&entry.hop, NextHop::Peer(id) if id == peer_id));
            !bucket.entries.is_empty()
        });
        before != self.route_entry_count()
    }

    /// Remove all routes learned from a specific upstream. Returns `true` if
    /// any entries were actually removed.
    pub fn remove_upstream(&mut self, upstream_id: &str) -> bool {
        let before = self.route_entry_count();
        self.routes.retain(|_, bucket| {
            bucket
                .entries
                .retain(|entry| !matches!(&entry.hop, NextHop::Upstream(id) if id == upstream_id));
            !bucket.entries.is_empty()
        });
        before != self.route_entry_count()
    }

    fn route_entry_count(&self) -> usize {
        self.routes
            .values()
            .map(|bucket| bucket.entries.len())
            .sum()
    }

    /// Resolve the best next-hop for a target address.
    ///
    /// Tries session key → runtime key → domain key, returning the first
    /// match with the lowest distance. Optionally avoids a specific next-hop
    /// (for split-horizon / source avoidance).
    pub fn resolve(&self, target: &RouteAddress, avoid: Option<&NextHop>) -> Option<RouteEntry> {
        self.best_for_key(&target.key(), avoid)
            .or_else(|| {
                target
                    .runtime_key()
                    .and_then(|key| self.best_for_key(&key, avoid))
            })
            .or_else(|| self.best_for_key(&target.domain_key(), avoid))
    }

    fn best_for_key(&self, key: &str, avoid: Option<&NextHop>) -> Option<RouteEntry> {
        self.routes.get(key).and_then(|bucket| {
            bucket
                .entries
                .iter()
                .filter(|entry| avoid.is_none_or(|avoid| &entry.hop != avoid))
                .min_by_key(|entry| entry.distance)
                .cloned()
        })
    }

    /// Export all best routes (no split-horizon avoidance).
    pub fn export_announcements(&self) -> Vec<RouteAnnouncement> {
        self.export_announcements_excluding(None)
    }

    /// Export best routes, excluding those learned from the avoided next-hop.
    pub fn export_announcements_excluding(
        &self,
        avoid: Option<&NextHop>,
    ) -> Vec<RouteAnnouncement> {
        let mut rows = self
            .routes
            .values()
            .filter_map(|bucket| {
                bucket
                    .entries
                    .iter()
                    .filter(|entry| avoid.is_none_or(|avoid| &entry.hop != avoid))
                    .min_by_key(|entry| entry.distance)
                    .map(|entry| RouteAnnouncement {
                        address: bucket.address.clone(),
                        distance: entry.distance,
                    })
            })
            .collect::<Vec<_>>();
        rows.sort_by_key(|a| a.address.key());
        rows.dedup_by(|a, b| a.address.key() == b.address.key());
        rows
    }

    /// Snapshot the full route table for diagnostics / display.
    pub fn snapshot(&self) -> Vec<(String, Vec<RouteEntry>)> {
        let mut rows = self
            .routes
            .iter()
            .map(|(key, bucket)| {
                let mut entries = bucket.entries.clone();
                entries.sort_by_key(|entry| entry.distance);
                (key.clone(), entries)
            })
            .collect::<Vec<_>>();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        rows
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glassvein_protocol::RouteAddress;

    /// Helper: build a session-level address.
    fn session_addr(domain: &str, runtime: &str, session: &str) -> RouteAddress {
        RouteAddress::new(domain, Some(runtime), Some(session))
    }

    /// Helper: build a runtime-level address.
    fn runtime_addr(domain: &str, runtime: &str) -> RouteAddress {
        RouteAddress::new(domain, Some(runtime), Option::<String>::None)
    }

    /// Helper: build a domain-level address.
    fn domain_addr(domain: &str) -> RouteAddress {
        RouteAddress::domain(domain)
    }

    /// Helper: announce a route with given distance from a specific hop.
    fn announce(table: &mut RouteTable, addr: &RouteAddress, distance: u16, hop: NextHop) {
        let ann = RouteAnnouncement {
            address: addr.clone(),
            distance,
        };
        table.upsert_announcement(&ann, hop);
    }

    // ---------------------------------------------------------------
    // 1. Shortest distance selection
    // ---------------------------------------------------------------

    #[test]
    fn resolve_picks_shortest_distance() {
        let mut table = RouteTable::default();
        let addr = domain_addr("d1");

        announce(&mut table, &addr, 3, NextHop::Peer("p1".into()));
        announce(&mut table, &addr, 1, NextHop::Peer("p2".into()));

        let result = table.resolve(&addr, None).expect("should resolve");
        assert_eq!(result.distance, 2); // 1 + 1 (saturating_add)
        assert_eq!(result.hop, NextHop::Peer("p2".into()));
    }

    #[test]
    fn resolve_picks_shortest_among_mixed_hops() {
        let mut table = RouteTable::default();
        let addr = domain_addr("d1");

        announce(&mut table, &addr, 5, NextHop::Upstream("u1".into()));
        announce(&mut table, &addr, 1, NextHop::Peer("p1".into()));
        announce(&mut table, &addr, 3, NextHop::Upstream("u2".into()));

        let result = table.resolve(&addr, None).expect("should resolve");
        assert_eq!(result.distance, 2);
        assert_eq!(result.hop, NextHop::Peer("p1".into()));
    }

    // ---------------------------------------------------------------
    // 2. Runtime / domain fallback
    // ---------------------------------------------------------------

    #[test]
    fn resolve_falls_back_to_runtime_key() {
        let mut table = RouteTable::default();
        let sess = session_addr("d1", "r1", "s1");

        let rt = runtime_addr("d1", "r1");
        announce(&mut table, &rt, 0, NextHop::Peer("p1".into()));

        let result = table
            .resolve(&sess, None)
            .expect("should resolve via runtime fallback");
        assert_eq!(result.distance, 1);
        assert_eq!(result.hop, NextHop::Peer("p1".into()));
    }

    #[test]
    fn resolve_falls_back_to_domain_key() {
        let mut table = RouteTable::default();
        let sess = session_addr("d1", "r1", "s1");

        let dom = domain_addr("d1");
        announce(&mut table, &dom, 0, NextHop::Peer("p1".into()));

        let result = table
            .resolve(&sess, None)
            .expect("should resolve via domain fallback");
        assert_eq!(result.distance, 1);
        assert_eq!(result.hop, NextHop::Peer("p1".into()));
    }

    #[test]
    fn resolve_prefers_session_over_runtime_over_domain() {
        let mut table = RouteTable::default();
        let sess = session_addr("d1", "r1", "s1");
        let rt = runtime_addr("d1", "r1");
        let dom = domain_addr("d1");

        announce(&mut table, &sess, 10, NextHop::Peer("p_session".into()));
        announce(&mut table, &rt, 5, NextHop::Peer("p_runtime".into()));
        announce(&mut table, &dom, 1, NextHop::Peer("p_domain".into()));

        let result = table.resolve(&sess, None).expect("should resolve");
        assert_eq!(result.hop, NextHop::Peer("p_session".into()));
    }

    #[test]
    fn resolve_returns_none_when_no_route_at_any_level() {
        let table = RouteTable::default();
        let addr = domain_addr("nonexistent");
        assert!(table.resolve(&addr, None).is_none());
    }

    // ---------------------------------------------------------------
    // 3. Split horizon export
    // ---------------------------------------------------------------

    #[test]
    fn export_excluding_does_not_return_routes_from_avoided_hop() {
        let mut table = RouteTable::default();
        let addr = domain_addr("d1");

        announce(&mut table, &addr, 0, NextHop::Peer("p1".into()));
        announce(&mut table, &addr, 2, NextHop::Upstream("u1".into()));

        let avoid = NextHop::Peer("p1".into());
        let exported = table.export_announcements_excluding(Some(&avoid));

        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].address, addr);
        assert_eq!(exported[0].distance, 3);
    }

    #[test]
    fn export_excluding_with_no_avoid_returns_all_best() {
        let mut table = RouteTable::default();
        let addr = domain_addr("d1");

        announce(&mut table, &addr, 0, NextHop::Peer("p1".into()));
        announce(&mut table, &addr, 2, NextHop::Upstream("u1".into()));

        let exported = table.export_announcements_excluding(None);
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].distance, 1);
    }

    #[test]
    fn split_horizon_prevents_echo_back_to_upstream() {
        let mut table = RouteTable::default();
        let addr = domain_addr("d1");

        announce(&mut table, &addr, 0, NextHop::Upstream("upstream_a".into()));
        announce(&mut table, &addr, 4, NextHop::Peer("p1".into()));

        let avoid = NextHop::Upstream("upstream_a".into());
        let exported = table.export_announcements_excluding(Some(&avoid));

        assert!(exported.iter().all(|a| a.distance != 1));
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].distance, 5);
    }

    // ---------------------------------------------------------------
    // 4. remove_peer / remove_upstream
    // ---------------------------------------------------------------

    #[test]
    fn remove_peer_clears_all_peer_routes() {
        let mut table = RouteTable::default();
        let d1 = domain_addr("d1");
        let d2 = domain_addr("d2");

        announce(&mut table, &d1, 0, NextHop::Peer("p1".into()));
        announce(&mut table, &d2, 0, NextHop::Peer("p1".into()));
        announce(&mut table, &d1, 2, NextHop::Upstream("u1".into()));

        let changed = table.remove_peer("p1");
        assert!(changed, "should report a change");

        let r = table.resolve(&d1, None).expect("d1 should resolve via u1");
        assert_eq!(r.hop, NextHop::Upstream("u1".into()));

        assert!(table.resolve(&d2, None).is_none());
    }

    #[test]
    fn remove_upstream_clears_all_upstream_routes() {
        let mut table = RouteTable::default();
        let d1 = domain_addr("d1");
        let d2 = domain_addr("d2");

        announce(&mut table, &d1, 0, NextHop::Upstream("u1".into()));
        announce(&mut table, &d2, 0, NextHop::Upstream("u1".into()));
        announce(&mut table, &d1, 5, NextHop::Peer("p1".into()));

        let changed = table.remove_upstream("u1");
        assert!(changed, "should report a change");

        let r = table.resolve(&d1, None).expect("d1 should resolve via p1");
        assert_eq!(r.hop, NextHop::Peer("p1".into()));

        assert!(table.resolve(&d2, None).is_none());
    }

    #[test]
    fn remove_peer_returns_false_when_nothing_removed() {
        let mut table = RouteTable::default();
        let d1 = domain_addr("d1");
        announce(&mut table, &d1, 0, NextHop::Upstream("u1".into()));

        let changed = table.remove_peer("nonexistent_peer");
        assert!(!changed, "nothing should change");
    }

    #[test]
    fn remove_upstream_returns_false_when_nothing_removed() {
        let mut table = RouteTable::default();
        let d1 = domain_addr("d1");
        announce(&mut table, &d1, 0, NextHop::Peer("p1".into()));

        let changed = table.remove_upstream("nonexistent_upstream");
        assert!(!changed, "nothing should change");
    }

    #[test]
    fn remove_peer_cleans_up_fallback_buckets() {
        let mut table = RouteTable::default();
        let sess = session_addr("d1", "r1", "s1");

        announce(&mut table, &sess, 0, NextHop::Peer("p1".into()));

        assert!(table.resolve(&sess, None).is_some());

        table.remove_peer("p1");

        assert!(table.resolve(&sess, None).is_none());
    }
}
