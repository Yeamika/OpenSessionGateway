use std::collections::HashMap;

use glassvein_protocol::{RouteAddress, RouteAnnouncement};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum NextHop {
    Peer(String),
    Upstream(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForwardAction {
    DeliverPeer { peer_id: String },
    ForwardUpstream { upstream_id: String },
    Drop { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteEntry {
    pub hop: NextHop,
    pub distance: u16,
}

#[derive(Clone, Debug)]
struct RouteBucket {
    address: RouteAddress,
    entries: Vec<RouteEntry>,
}

#[derive(Clone, Debug, Default)]
pub struct RouteTable {
    routes: HashMap<String, RouteBucket>,
}

impl RouteTable {
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

    pub fn export_announcements(&self) -> Vec<RouteAnnouncement> {
        self.export_announcements_excluding(None)
    }

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
        rows.sort_by(|a, b| a.address.key().cmp(&b.address.key()));
        rows.dedup_by(|a, b| a.address.key() == b.address.key());
        rows
    }

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
