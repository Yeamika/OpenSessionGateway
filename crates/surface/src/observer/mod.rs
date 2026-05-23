//! Observer surface — subscribe to envelope observations in the routing graph.
//!
//! An observer surface receives a stream of [`Observation`]s when the router
//! processes envelopes.  Observers do **not** inject messages; they are
//! passive watchers.
//!
//! ## Visibility rule
//!
//! Surface visibility is **local-only by default**:
//!
//! - A surface attached to router R sees envelopes processed by R, including
//!   child-client traffic and child-client session updates.
//! - A surface does **NOT** see traffic from parent routers, sibling routers,
//!   or sibling surfaces.
//! - Control commands can traverse domains (cross-domain routing), but the
//!   observation stream remains local to the subscribing router.
//!
//! Only endpoints registered with a `Surface` (or `Panel`) role receive
//! observation events.  Regular `Client` role endpoints only see messages
//! routed directly to them.

use osgp::{SessionAddress, SessionEnvelope};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Visibility scope for an observer surface.
///
/// Determines which part of the routing graph the observer can see.
/// Default is `LocalRouter` — the surface only sees traffic processed
/// by its own router node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisibilityScope {
    /// Only see traffic processed by the local router (default).
    ///
    /// Includes: child-client traffic, child-client session updates,
    /// local delivery, local drops.
    /// Excludes: parent-router traffic, sibling-router traffic.
    LocalRouter,
    /// See traffic from the local router and one level upstream.
    ///
    /// Useful for management surfaces that need parent context.
    LocalAndUpstream,
    /// See all traffic in the routing tree (full tap).
    ///
    /// Use sparingly — this defeats the locality guarantee.
    FullTree,
}

impl Default for VisibilityScope {
    fn default() -> Self {
        Self::LocalRouter
    }
}

/// Direction of the observed envelope relative to the router node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Envelope was forwarded toward an upstream neighbor.
    ForwardUpstream,
    /// Envelope was forwarded toward a downstream peer.
    ForwardPeer,
    /// Envelope was delivered locally.
    LocalDelivery,
    /// Envelope was dropped (no route / TTL exhausted).
    Drop,
}

/// A single observation event surfaced to an observer.
///
/// The router does **not** parse OSG business payload — that is the
/// responsibility of downstream surface crates or application code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    /// The envelope that was processed.
    pub envelope: SessionEnvelope,
    /// Which direction the envelope was forwarded.
    pub direction: Direction,
    /// The neighbor/node the envelope was forwarded to (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forwarded_to: Option<String>,
    /// Epoch-seconds timestamp when the observation was made.
    pub observed_at: f64,
    /// Optional human-readable note from the router.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// The router node that emitted this observation.
    ///
    /// Used by `VisibilityScope::LocalRouter` to filter out events
    /// from parent/sibling routers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_router_id: Option<String>,
}

/// Filter criteria for an observer subscription.
#[derive(Debug, Clone, Default)]
pub struct ObserverFilter {
    /// Only observe envelopes whose target matches this address.
    /// `None` means observe all.
    pub target_filter: Option<SessionAddress>,
    /// Only observe envelopes whose source matches this address.
    /// `None` means observe all.
    pub source_filter: Option<SessionAddress>,
    /// Only observe envelopes of this kind/subtype label (e.g. `"add_prompt"`).
    /// `None` means observe all kinds.
    pub kind_filter: Option<String>,
    /// Visibility scope — determines which part of the routing graph
    /// the observer can see.  Default: `LocalRouter`.
    pub visibility_scope: VisibilityScope,
    /// The router node ID this surface is attached to.
    ///
    /// Required for `LocalRouter` scope to determine which events are
    /// "local" vs "upstream/sibling".
    pub local_router_id: Option<String>,
}

impl ObserverFilter {
    /// Returns `true` if the given observation passes this filter.
    ///
    /// Address matching is hierarchical: a filter with only `domain` set
    /// matches any observation in that domain, regardless of runtime/session.
    ///
    /// Visibility scope is checked first: if the observation's origin router
    /// does not match the local router (for `LocalRouter` scope), it is
    /// rejected before address/kind filters are applied.
    pub fn matches(&self, obs: &Observation) -> bool {
        // Visibility scope check
        match self.visibility_scope {
            VisibilityScope::LocalRouter => {
                // Only see events from our own router
                if let (Some(ref local_id), Some(ref origin_id)) =
                    (&self.local_router_id, &obs.origin_router_id)
                {
                    if local_id != origin_id {
                        return false; // event from parent/sibling router
                    }
                }
            }
            VisibilityScope::LocalAndUpstream => {
                // See local + upstream events (upstream has no origin_router_id
                // or a different one — we allow both)
            }
            VisibilityScope::FullTree => {
                // See everything
            }
        }

        if let Some(ref target) = self.target_filter {
            if !address_matches(target, &obs.envelope.target) {
                return false;
            }
        }
        if let Some(ref source) = self.source_filter {
            if !address_matches(source, &obs.envelope.source) {
                return false;
            }
        }
        if let Some(ref kind) = self.kind_filter {
            if obs.envelope.subtype != kind.as_str() && obs.envelope.kind != kind.as_str() {
                return false;
            }
        }
        true
    }
}

/// Hierarchical address matching: `None` fields in the filter are wildcards.
fn address_matches(filter: &SessionAddress, candidate: &SessionAddress) -> bool {
    if filter.domain != candidate.domain {
        return false;
    }
    match &filter.runtime {
        Some(fr) => match &candidate.runtime {
            Some(cr) if fr == cr => {}
            _ => return false,
        },
        None => {} // wildcard — any runtime matches
    }
    match &filter.session {
        Some(fs) => match &candidate.session {
            Some(cs) if fs == cs => {}
            _ => return false,
        },
        None => {} // wildcard — any session matches
    }
    true
}

/// An observer surface that receives a stream of [`Observation`]s.
///
/// Created via [`ObserverSurface::new`], which returns the surface and a
/// [`broadcast::Receiver`] for consuming observations.
///
/// ## Local-only visibility
///
/// By default, the observer only sees events from its local router.
/// This is enforced by setting `visibility_scope = LocalRouter` and
/// `local_router_id = Some("my-router")` in the filter.  Events from
/// parent/sibling routers are silently dropped.
pub struct ObserverSurface {
    filter: ObserverFilter,
    tx: broadcast::Sender<Observation>,
}

impl ObserverSurface {
    /// Create a new observer surface with the given channel capacity.
    ///
    /// Returns `(surface, receiver)`.  The surface is used to emit
    /// observations (typically called by the router); the receiver is
    /// given to the observer endpoint.
    pub fn new(capacity: usize) -> (Self, broadcast::Receiver<Observation>) {
        let (tx, rx) = broadcast::channel(capacity);
        (
            Self {
                filter: ObserverFilter::default(),
                tx,
            },
            rx,
        )
    }

    /// Create a new observer surface with a filter.
    pub fn with_filter(
        capacity: usize,
        filter: ObserverFilter,
    ) -> (Self, broadcast::Receiver<Observation>) {
        let (tx, rx) = broadcast::channel(capacity);
        (Self { filter, tx }, rx)
    }

    /// Emit an observation to all subscribers.
    ///
    /// Returns `Ok(())` if at least one subscriber received the event,
    /// or `Err` if no subscribers are connected (lagged or empty).
    pub fn emit(&self, observation: Observation) -> Result<(), Observation> {
        if !self.filter.matches(&observation) {
            return Ok(()); // filtered out, not an error
        }
        self.tx.send(observation).map(|_| ()).map_err(|e| e.0)
    }

    /// Get the number of active subscribers.
    pub fn subscriber_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests;
