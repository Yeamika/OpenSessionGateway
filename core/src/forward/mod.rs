//! Forward engine: central coordinator tying routing, filtering, and transport.
//!
//! `ForwardEngine` is the main entry point for envelope processing:
//! 1. Receive an envelope via any transport.
//! 2. Apply the filter pipeline.
//! 3. Resolve the route via the route table.
//! 4. Emit `TapEvent`s at each stage.
//! 5. Execute the decision by sending the envelope through the appropriate
//!    transport.
//!
//! The engine does **not** manage connections or route announcements — those
//! remain the responsibility of the caller (typically `router::RouterNode`).

#[cfg(test)]
mod tests;
mod types;

use std::sync::Arc;

use anyhow::Result;
use osgp::{LinkMessage, SessionEnvelope};
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, warn};

use crate::filter::{FilterContext, FilterDecision, FilterRule};
use crate::route::{NextHop, RouteTable};
use crate::tap::TapEvent;
use crate::transport::TransportMap;

pub use types::{ForwardMetricsSnapshot, ForwardPlan, RouteDecision};
use types::{ForwardMetrics, NoRouteExt};

// ── ForwardEngine ───────────────────────────────────────────────────

/// The core forwarding engine.
///
/// Thread-safe and designed to be shared across multiple async tasks.
/// Owns the route table, a list of filter rules, a tap event broadcaster,
/// and forwarding metrics.
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

    /// Get a clone of the route table ARC for external mutation.
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
            forwarded_total: self.metrics.forwarded_total.load(std::sync::atomic::Ordering::Relaxed),
            dropped_total: self.metrics.dropped_total.load(std::sync::atomic::Ordering::Relaxed),
            filtered_total: self.metrics.filtered_total.load(std::sync::atomic::Ordering::Relaxed),
        }
    }

    /// Emit a tap event (non-blocking; drops if no receiver).
    fn emit_tap(&self, event: TapEvent) {
        let _ = self.tap_sender.send(event);
    }

    // ── Core processing ────────────────────────────────────────────

    /// Process an incoming envelope through the full pipeline:
    /// 1. Hop recording (appends this router to route_hops)
    /// 2. TTL check
    /// 3. Filter pipeline
    /// 4. Route resolution
    ///
    /// Returns the routing decision. Call [`execute_decision`] to actually
    /// send the envelope.
    pub async fn process_envelope(
        &self,
        mut envelope: SessionEnvelope,
        from_neighbor: Option<&str>,
        is_from_upstream: bool,
    ) -> RouteDecision {
        // ── 1. Record hop + TTL check ─────────────────────────────
        envelope.route_hops.push(self.router_id.clone());

        if envelope.ttl == 0 {
            self.metrics.record_drop();
            let reason = "ttl exhausted".to_string();
            self.emit_tap(TapEvent::EnvelopeDropped {
                router_id: self.router_id.clone(),
                envelope_id: envelope.id.to_string(),
                reason: reason.clone(),
            });
            return RouteDecision {
                plan: ForwardPlan::Drop { reason },
                blocked_by_filter: None,
                hops: envelope.route_hops,
            };
        }
        envelope.ttl -= 1;

        let envelope_id = envelope.id.to_string();

        self.emit_tap(TapEvent::EnvelopeReceived {
            router_id: self.router_id.clone(),
            envelope_id: envelope_id.clone(),
            source: envelope.source.clone(),
            target: envelope.target.clone(),
            kind: envelope.kind.clone(),
            ttl: envelope.ttl,
        });

        // ── 2. Filter pipeline ────────────────────────────────────
        let filter_ctx = FilterContext {
            router_id: self.router_id.clone(),
            source_neighbor: from_neighbor.map(String::from),
        };

        for filter in &self.filters {
            let decision = filter.apply(&mut envelope, &filter_ctx);
            self.emit_tap(TapEvent::FilterApplied {
                router_id: self.router_id.clone(),
                envelope_id: envelope_id.clone(),
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
                    envelope_id: envelope_id.clone(),
                    reason: reason.clone(),
                });
                return RouteDecision {
                    plan: ForwardPlan::Drop { reason },
                    blocked_by_filter: Some(filter.name().to_string()),
                    hops: envelope.route_hops,
                };
            }
        }

        // ── 3. Route resolution ───────────────────────────────────
        let fwd_decision = self
            .route_table
            .read()
            .await
            .decide_for_target(&envelope.target, from_neighbor);

        let plan = match &fwd_decision.next_hop {
            NextHop::Local => ForwardPlan::DeliverLocal,
            NextHop::Neighbor(id) => ForwardPlan::ForwardNeighbor {
                neighbor_id: id.clone(),
            },
            NextHop::Drop(reason) => {
                ForwardPlan::NoRoute {
                    fallback_available: !is_from_upstream,
                }
                .or_else_drop(reason)
            }
        };

        let target_neighbor = match &plan {
            ForwardPlan::ForwardNeighbor { neighbor_id } => Some(neighbor_id.clone()),
            _ => None,
        };

        self.emit_tap(TapEvent::ForwardDecided {
            router_id: self.router_id.clone(),
            envelope_id: envelope_id.clone(),
            neighbor: target_neighbor.clone(),
            dropped: matches!(plan, ForwardPlan::Drop { .. } | ForwardPlan::NoRoute { .. }),
            reason: match &plan {
                ForwardPlan::Drop { reason } => Some(reason.clone()),
                ForwardPlan::NoRoute { .. } => Some("no route".to_string()),
                _ => None,
            },
        });

        RouteDecision {
            plan,
            blocked_by_filter: None,
            hops: envelope.route_hops,
        }
    }

    /// Execute a routing decision by sending the envelope through the
    /// appropriate transport.
    pub async fn execute_decision(
        &self,
        envelope: SessionEnvelope,
        decision: &RouteDecision,
        transport_map: &TransportMap,
    ) -> Result<()> {
        let envelope_id = envelope.id.to_string();

        match &decision.plan {
            ForwardPlan::DeliverLocal | ForwardPlan::ForwardNeighbor { .. } => {
                let target_id = match &decision.plan {
                    ForwardPlan::ForwardNeighbor { neighbor_id } => neighbor_id.clone(),
                    ForwardPlan::DeliverLocal => {
                        return Ok(());
                    }
                    _ => unreachable!(),
                };

                let transport = transport_map.get(&target_id).await;
                if let Some(transport) = transport {
                    self.metrics.record_forward();
                    self.emit_tap(TapEvent::EnvelopeForwarded {
                        router_id: self.router_id.clone(),
                        envelope_id: envelope_id.clone(),
                        target_neighbor: target_id.clone(),
                        target_address: envelope.target.clone(),
                    });
                    let wire = LinkMessage::Envelope(envelope);
                    transport.send(wire).await?;
                } else {
                    self.metrics.record_drop();
                    warn!(
                        router = %self.router_id,
                        %envelope_id,
                        %target_id,
                        "envelope dropped: transport not found"
                    );
                }
            }
            ForwardPlan::Drop { reason } => {
                self.metrics.record_drop();
                debug!(
                    router = %self.router_id,
                    %envelope_id,
                    %reason,
                    "envelope dropped"
                );
            }
            ForwardPlan::NoRoute { fallback_available } => {
                if *fallback_available {
                    if let Some((neighbor_id, transport)) = transport_map.smallest().await {
                        self.metrics.record_forward();
                        self.emit_tap(TapEvent::EnvelopeForwarded {
                            router_id: self.router_id.clone(),
                            envelope_id: envelope_id.clone(),
                            target_neighbor: neighbor_id.clone(),
                            target_address: envelope.target.clone(),
                        });
                        let wire = LinkMessage::Envelope(envelope);
                        transport.send(wire).await?;
                        return Ok(());
                    }
                }
                self.metrics.record_drop();
                warn!(
                    router = %self.router_id,
                    %envelope_id,
                    "envelope dropped: no route and no fallback"
                );
            }
        }

        Ok(())
    }
}
