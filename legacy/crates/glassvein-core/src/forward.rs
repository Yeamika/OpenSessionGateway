//! Forward engine: the central coordinator that ties routing, filtering,
//! and transport together.
//!
//! `ForwardEngine` is the main entry point for envelope processing:
//! 1. Receive an envelope via any transport.
//! 2. Apply the filter pipeline.
//! 3. Resolve the route via the route table.
//! 4. Produce a `RouteDecision` (forward / deliver / drop / no-route).
//! 5. Emit `TapEvent`s at each stage.
//! 6. Execute the decision by sending the envelope through the appropriate
//!    transport.
//!
//! The engine does **not** manage connections or route announcements — those
//! remain the responsibility of the caller (typically `glassvein-router`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use glassvein_protocol::WireMessage;
use glassvein_protocol::{RouteAddress, RouteEnvelope};
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, info, warn};

use crate::filter::{FilterContext, FilterDecision, FilterRule};
use crate::route::{NextHop, RouteEntry, RouteTable};
use crate::tap::{ForwardPlanDef, NextHopDef, TapEvent};
use crate::transport::TransportMap;

// ── ForwardPlan ─────────────────────────────────────────────────────

/// What the forward engine plans to do with an envelope.
///
/// This is the internal representation; [`ForwardPlanDef`] is the
/// serializable form used in tap events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForwardPlan {
    /// Deliver locally to an attached peer.
    DeliverLocal { peer_id: String },
    /// Forward to a downstream peer (router or client).
    ForwardPeer { peer_id: String },
    /// Forward to an upstream router.
    ForwardUpstream { upstream_id: String },
    /// Drop the envelope with a reason.
    Drop { reason: String },
    /// No route found; fallback to upstream if available.
    NoRoute { fallback_available: bool },
}

impl ForwardPlan {
    /// Convert to the serializable form for tap events.
    pub fn to_def(&self) -> ForwardPlanDef {
        match self {
            Self::DeliverLocal { peer_id } => ForwardPlanDef::DeliverLocal {
                peer_id: peer_id.clone(),
            },
            Self::ForwardPeer { peer_id } => ForwardPlanDef::ForwardPeer {
                peer_id: peer_id.clone(),
            },
            Self::ForwardUpstream { upstream_id } => ForwardPlanDef::ForwardUpstream {
                upstream_id: upstream_id.clone(),
            },
            Self::Drop { reason } => ForwardPlanDef::Drop {
                reason: reason.clone(),
            },
            Self::NoRoute { fallback_available } => ForwardPlanDef::NoRoute {
                fallback_available: *fallback_available,
            },
        }
    }

    /// Get the target transport ID (peer or upstream), if any.
    pub fn target_id(&self) -> Option<&str> {
        match self {
            Self::DeliverLocal { peer_id } => Some(peer_id),
            Self::ForwardPeer { peer_id } => Some(peer_id),
            Self::ForwardUpstream { upstream_id } => Some(upstream_id),
            Self::Drop { .. } | Self::NoRoute { .. } => None,
        }
    }

    /// Returns true if this plan involves forwarding to an upstream.
    pub fn is_upstream(&self) -> bool {
        matches!(self, Self::ForwardUpstream { .. })
    }
}

// ── RouteDecision ───────────────────────────────────────────────────

/// The complete routing decision for an envelope, including filter results
/// and route metadata.
#[derive(Clone, Debug)]
pub struct RouteDecision {
    /// The forward plan decided by the engine.
    pub plan: ForwardPlan,
    /// Name of the filter that caused a drop (if any).
    pub blocked_by_filter: Option<String>,
    /// Distance of the selected route (if a route was found).
    pub distance: Option<u16>,
    /// Route hops accumulated so far.
    pub hops: Vec<String>,
}

// ── ForwardMetrics ──────────────────────────────────────────────────

#[derive(Default)]
struct ForwardMetrics {
    forwarded_total: AtomicU64,
    forwarded_bytes_total: AtomicU64,
    dropped_total: AtomicU64,
    filtered_total: AtomicU64,
}

impl ForwardMetrics {
    fn record_forward(&self, envelope: &RouteEnvelope) {
        let bytes = serde_json::to_vec(envelope)
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0);
        self.forwarded_total.fetch_add(1, Ordering::Relaxed);
        self.forwarded_bytes_total
            .fetch_add(bytes, Ordering::Relaxed);
    }

    fn record_drop(&self) {
        self.dropped_total.fetch_add(1, Ordering::Relaxed);
    }

    fn record_filtered(&self) {
        self.filtered_total.fetch_add(1, Ordering::Relaxed);
    }
}

// ── ForwardEngine ───────────────────────────────────────────────────

/// The core forwarding engine.
///
/// Thread-safe and designed to be shared across multiple async tasks.
/// The engine owns the route table, a list of filter rules, a tap event
/// broadcaster, and forwarding metrics.
pub struct ForwardEngine {
    router_id: String,
    route_table: Arc<RwLock<RouteTable>>,
    filters: Vec<Box<dyn FilterRule>>,
    tap_sender: broadcast::Sender<TapEvent>,
    metrics: Arc<ForwardMetrics>,
}

impl ForwardEngine {
    /// Create a new forward engine with the given router ID and filters.
    pub fn new(router_id: String, filters: Vec<Box<dyn FilterRule>>) -> Self {
        let (tap_sender, _) = broadcast::channel::<TapEvent>(1024);
        Self {
            router_id,
            route_table: Arc::new(RwLock::new(RouteTable::default())),
            filters,
            tap_sender,
            metrics: Arc::new(ForwardMetrics::default()),
        }
    }

    /// Create an engine with no filters.
    pub fn new_no_filters(router_id: String) -> Self {
        Self::new(router_id, vec![])
    }

    /// Get a clone of the route table ARC for external mutation
    /// (e.g., applying route announcements from connection handlers).
    pub fn route_table(&self) -> Arc<RwLock<RouteTable>> {
        self.route_table.clone()
    }

    /// Subscribe to tap events.
    pub fn tap_subscribe(&self) -> broadcast::Receiver<TapEvent> {
        self.tap_sender.subscribe()
    }

    /// Get the router ID.
    pub fn router_id(&self) -> &str {
        &self.router_id
    }

    /// Get a snapshot of forwarding metrics.
    pub fn metrics_snapshot(&self) -> ForwardMetricsSnapshot {
        ForwardMetricsSnapshot {
            forwarded_total: self.metrics.forwarded_total.load(Ordering::Relaxed),
            forwarded_bytes_total: self.metrics.forwarded_bytes_total.load(Ordering::Relaxed),
            dropped_total: self.metrics.dropped_total.load(Ordering::Relaxed),
            filtered_total: self.metrics.filtered_total.load(Ordering::Relaxed),
        }
    }

    /// Emit a tap event (non-blocking; drops if no receiver).
    fn emit_tap(&self, event: TapEvent) {
        let _ = self.tap_sender.send(event);
    }

    // ── Core processing ────────────────────────────────────────────

    /// Process an incoming envelope through the full pipeline:
    /// 1. TTL check
    /// 2. Filter pipeline
    /// 3. Route resolution
    /// 4. Forward plan creation
    ///
    /// Returns the routing decision. Call [`execute_decision`] to actually
    /// send the envelope.
    pub async fn process_envelope(
        &self,
        envelope: RouteEnvelope,
        from_hop: Option<&NextHop>,
        is_from_upstream: bool,
    ) -> RouteDecision {
        // ── 1. TTL check ───────────────────────────────────────────
        let Some(envelope) = envelope.hop(self.router_id.clone()) else {
            self.metrics.record_drop();
            let reason = "ttl exhausted".to_string();
            self.emit_tap(TapEvent::EnvelopeDropped {
                router_id: self.router_id.clone(),
                message_id: "unknown".into(),
                reason: reason.clone(),
            });
            return RouteDecision {
                plan: ForwardPlan::Drop { reason },
                blocked_by_filter: None,
                distance: None,
                hops: vec![],
            };
        };

        let message_id = envelope.message_id.clone();

        self.emit_tap(TapEvent::EnvelopeReceived {
            router_id: self.router_id.clone(),
            message_id: message_id.clone(),
            source: envelope.source.clone(),
            target: envelope.target.clone(),
            kind: envelope.kind.clone(),
            ttl: envelope.ttl,
            from_hop: from_hop.map(NextHopDef::from),
        });

        // ── 2. Filter pipeline ────────────────────────────────────
        let filter_ctx = FilterContext {
            router_id: self.router_id.clone(),
            source_hop: from_hop.cloned(),
            route_entry: None,
        };

        let mut envelope = envelope;
        for filter in &self.filters {
            let decision = filter.apply(&mut envelope, &filter_ctx);
            self.emit_tap(TapEvent::FilterApplied {
                router_id: self.router_id.clone(),
                message_id: message_id.clone(),
                filter_name: filter.name().to_string(),
                decision: match &decision {
                    FilterDecision::Allow => "allow".to_string(),
                    FilterDecision::Drop(r) => format!("drop: {r}"),
                    FilterDecision::Transform => "transform".to_string(),
                },
            });

            if let FilterDecision::Drop(reason) = decision {
                self.metrics.record_drop();
                self.metrics.record_filtered();
                self.emit_tap(TapEvent::EnvelopeDropped {
                    router_id: self.router_id.clone(),
                    message_id: message_id.clone(),
                    reason: reason.clone(),
                });
                return RouteDecision {
                    plan: ForwardPlan::Drop { reason },
                    blocked_by_filter: Some(filter.name().to_string()),
                    distance: None,
                    hops: envelope.route_hops.clone(),
                };
            }
        }

        // ── 3. Route resolution ───────────────────────────────────
        let avoid = from_hop.cloned();
        let route_entry = self.route_table.read().await.resolve(&envelope.target, avoid.as_ref());

        let plan = if let Some(entry) = &route_entry {
            match &entry.hop {
                NextHop::Peer(peer_id) => ForwardPlan::ForwardPeer {
                    peer_id: peer_id.clone(),
                },
                NextHop::Upstream(upstream_id) => ForwardPlan::ForwardUpstream {
                    upstream_id: upstream_id.clone(),
                },
            }
        } else {
            // No route found. If not from upstream, try fallback.
            ForwardPlan::NoRoute {
                fallback_available: !is_from_upstream,
            }
        };

        self.emit_tap(TapEvent::ForwardDecided {
            router_id: self.router_id.clone(),
            message_id: message_id.clone(),
            plan: plan.to_def(),
            distance: route_entry.as_ref().map(|e| e.distance),
        });

        RouteDecision {
            plan,
            blocked_by_filter: None,
            distance: route_entry.as_ref().map(|e| e.distance),
            hops: envelope.route_hops.clone(),
        }
    }

    /// Execute a routing decision by sending the envelope through the
    /// appropriate transport.
    ///
    /// For `NoRoute` plans with `fallback_available`, attempts the
    /// lexicographically smallest upstream.
    pub async fn execute_decision(
        &self,
        envelope: RouteEnvelope,
        decision: &RouteDecision,
        transport_map: &TransportMap,
        upstream_transport_map: &TransportMap,
    ) -> Result<()> {
        let message_id = envelope.message_id.clone();

        let target_id = match &decision.plan {
            ForwardPlan::DeliverLocal { peer_id } => {
                // Deliver local = send to peer transport
                Some(peer_id.clone())
            }
            ForwardPlan::ForwardPeer { peer_id } => Some(peer_id.clone()),
            ForwardPlan::ForwardUpstream { upstream_id } => Some(upstream_id.clone()),
            ForwardPlan::Drop { reason } => {
                self.metrics.record_drop();
                info!(
                    router = %self.router_id,
                    %message_id,
                    %reason,
                    "envelope dropped"
                );
                return Ok(());
            }
            ForwardPlan::NoRoute { fallback_available } => {
                if *fallback_available {
                    // Deterministic fallback: pick smallest upstream ID
                    if let Some((upstream_id, transport)) = upstream_transport_map.smallest_id().await {
                        self.metrics.record_forward(&envelope);
                        self.emit_tap(TapEvent::EnvelopeForwarded {
                            router_id: self.router_id.clone(),
                            message_id: message_id.clone(),
                            target_id: upstream_id.clone(),
                            target_address: envelope.target.clone(),
                        });
                        let wire = WireMessage::Envelope {
                            envelope: Box::new(envelope),
                        };
                        transport.send(wire).await?;
                        return Ok(());
                    }
                }
                self.metrics.record_drop();
                warn!(
                    router = %self.router_id,
                    %message_id,
                    target = %envelope.target.key(),
                    "envelope dropped: no route and no fallback"
                );
                return Ok(());
            }
        };

        if let Some(id) = target_id {
            // Try peer transport first, then upstream transport
            let transport = transport_map.get(&id).await
                .or_else(|| {
                    // Synchronous check: upstream_transport_map
                    // Need to make this async-compatible
                    None
                });

            // We need to handle this differently since we can't .await inside or_else
            let transport = if transport.is_some() {
                transport
            } else {
                upstream_transport_map.get(&id).await
            };

            if let Some(transport) = transport {
                self.metrics.record_forward(&envelope);
                self.emit_tap(TapEvent::EnvelopeForwarded {
                    router_id: self.router_id.clone(),
                    message_id: message_id.clone(),
                    target_id: id.clone(),
                    target_address: envelope.target.clone(),
                });
                let wire = WireMessage::Envelope {
                    envelope: Box::new(envelope),
                };
                transport.send(wire).await?;
            } else {
                self.metrics.record_drop();
                warn!(
                    router = %self.router_id,
                    %message_id,
                    %id,
                    "envelope dropped: transport not found"
                );
            }
        }

        Ok(())
    }
}

// ── ForwardMetricsSnapshot ──────────────────────────────────────────

/// A point-in-time snapshot of forwarding metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForwardMetricsSnapshot {
    pub forwarded_total: u64,
    pub forwarded_bytes_total: u64,
    pub dropped_total: u64,
    pub filtered_total: u64,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filter::{DomainWhitelistFilter, KindBlockFilter};
    use crate::transport::InMemoryTransport;
    use glassvein_protocol::{RouteAddress, RouteAnnouncement};

    fn test_addr(domain: &str) -> RouteAddress {
        RouteAddress::new(domain, Some("rt1"), Some("s1"))
    }

    fn test_envelope(src_domain: &str, tgt_domain: &str) -> RouteEnvelope {
        RouteEnvelope::new(
            test_addr(src_domain),
            test_addr(tgt_domain),
            "test.ping",
            serde_json::json!({"msg": "hello"}),
        )
    }

    #[tokio::test]
    async fn process_envelope_no_filters_with_route() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        // Add a route: target-domain → peer p1, distance 1
        let ann = RouteAnnouncement::local(test_addr("target"));
        engine
            .route_table()
            .write()
            .await
            .upsert_announcement(&ann, NextHop::Peer("p1".into()));

        let envelope = test_envelope("src", "target");
        let decision = engine.process_envelope(envelope, None, false).await;

        assert!(decision.blocked_by_filter.is_none());
        assert_eq!(decision.distance, Some(1));
        match decision.plan {
            ForwardPlan::ForwardPeer { peer_id } => assert_eq!(peer_id, "p1"),
            other => panic!("expected ForwardPeer, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn process_envelope_ttl_exhausted() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let mut envelope = test_envelope("src", "target");
        envelope.ttl = 0;

        let decision = engine.process_envelope(envelope, None, false).await;

        match decision.plan {
            ForwardPlan::Drop { reason } => assert!(reason.contains("ttl")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn process_envelope_blocked_by_filter() {
        let engine = ForwardEngine::new(
            "router-1".into(),
            vec![Box::new(DomainWhitelistFilter::new(vec!["allowed".into()]))],
        );

        let envelope = test_envelope("allowed", "blocked");
        let decision = engine.process_envelope(envelope, None, false).await;

        assert_eq!(decision.blocked_by_filter, Some("domain_whitelist".to_string()));
        match decision.plan {
            ForwardPlan::Drop { reason } => assert!(reason.contains("blocked")),
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn process_envelope_no_route_with_fallback() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let envelope = test_envelope("src", "unknown");
        let decision = engine.process_envelope(envelope, None, false).await;

        match decision.plan {
            ForwardPlan::NoRoute { fallback_available } => assert!(fallback_available),
            other => panic!("expected NoRoute, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn process_envelope_no_route_from_upstream_no_fallback() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let envelope = test_envelope("src", "unknown");
        let decision = engine
            .process_envelope(envelope, Some(&NextHop::Upstream("u1".into())), true)
            .await;

        match decision.plan {
            ForwardPlan::NoRoute { fallback_available } => assert!(!fallback_available),
            other => panic!("expected NoRoute, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_decision_forward_peer() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let ann = RouteAnnouncement::local(test_addr("target"));
        engine
            .route_table()
            .write()
            .await
            .upsert_announcement(&ann, NextHop::Peer("p1".into()));

        let envelope = test_envelope("src", "target");
        let decision = engine.process_envelope(envelope, None, false).await;

        let (t_peer, t_peer_mirror) = InMemoryTransport::pair();
        let peer_map = TransportMap::new();
        peer_map.insert("p1".into(), Arc::new(t_peer)).await;

        let upstream_map = TransportMap::new();

        engine
            .execute_decision(test_envelope("src", "target"), &decision, &peer_map, &upstream_map)
            .await
            .unwrap();

        let received = t_peer_mirror.recv().await.unwrap().expect("should receive");
        match received {
            WireMessage::Envelope { envelope } => {
                assert_eq!(envelope.kind, "test.ping");
            }
            other => panic!("expected Envelope, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_decision_fallback_to_smallest_upstream() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let envelope = test_envelope("src", "unknown");
        let decision = engine.process_envelope(envelope, None, false).await;

        let (t_a, t_a_mirror) = InMemoryTransport::pair();
        let (t_z, t_z_mirror) = InMemoryTransport::pair();

        let upstream_map = TransportMap::new();
        upstream_map.insert("upstream-z".into(), Arc::new(t_z)).await;
        upstream_map.insert("upstream-a".into(), Arc::new(t_a)).await;

        let peer_map = TransportMap::new();

        engine
            .execute_decision(test_envelope("src", "unknown"), &decision, &peer_map, &upstream_map)
            .await
            .unwrap();

        // Should forward to upstream-a (smallest)
        let received = t_a_mirror.recv().await.unwrap().expect("should receive");
        match received {
            WireMessage::Envelope { envelope } => {
                assert_eq!(envelope.kind, "test.ping");
            }
            other => panic!("expected Envelope, got: {:?}", other),
        }

        // upstream-z should not receive anything
        let result = t_z_mirror.recv().await.unwrap();
        assert!(result.is_none(), "upstream-z should not receive");
    }

    #[tokio::test]
    async fn tap_events_are_emitted() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let mut tap_rx = engine.tap_subscribe();

        let ann = RouteAnnouncement::local(test_addr("target"));
        engine
            .route_table()
            .write()
            .await
            .upsert_announcement(&ann, NextHop::Peer("p1".into()));

        let envelope = test_envelope("src", "target");
        let _decision = engine.process_envelope(envelope, None, false).await;

        // Should have received EnvelopeReceived and ForwardDecided
        let mut received_count = 0;
        while let Ok(event) = tap_rx.try_recv() {
            received_count += 1;
            match event {
                TapEvent::EnvelopeReceived { .. } => {}
                TapEvent::ForwardDecided { .. } => {}
                other => panic!("unexpected tap event: {:?}", other),
            }
        }
        assert!(received_count >= 2, "should emit at least 2 tap events");
    }

    #[tokio::test]
    async fn metrics_snapshot_counts() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        let ann = RouteAnnouncement::local(test_addr("target"));
        engine
            .route_table()
            .write()
            .await
            .upsert_announcement(&ann, NextHop::Peer("p1".into()));

        let (t_peer, _) = InMemoryTransport::pair();
        let peer_map = TransportMap::new();
        peer_map.insert("p1".into(), Arc::new(t_peer)).await;
        let upstream_map = TransportMap::new();

        // Forward 3 envelopes
        for _ in 0..3 {
            let envelope = test_envelope("src", "target");
            let decision = engine.process_envelope(envelope, None, false).await;
            engine
                .execute_decision(test_envelope("src", "target"), &decision, &peer_map, &upstream_map)
                .await
                .unwrap();
        }

        let snap = engine.metrics_snapshot();
        assert_eq!(snap.forwarded_total, 3);
        assert!(snap.forwarded_bytes_total > 0);
    }

    #[tokio::test]
    async fn split_horizon_avoids_source_hop() {
        let engine = ForwardEngine::new_no_filters("router-1".into());

        // Route to "target" via peer "p1"
        let ann = RouteAnnouncement::local(test_addr("target"));
        engine
            .route_table()
            .write()
            .await
            .upsert_announcement(&ann, NextHop::Peer("p1".into()));

        // Process envelope that came FROM p1 → should not route back to p1
        let envelope = test_envelope("src", "target");
        let decision = engine
            .process_envelope(envelope, Some(&NextHop::Peer("p1".into())), false)
            .await;

        // Should fall to NoRoute since the only route is via p1 which is avoided
        match decision.plan {
            ForwardPlan::NoRoute { fallback_available } => assert!(fallback_available),
            other => panic!("expected NoRoute due to split horizon, got: {:?}", other),
        }
    }
}
