//! GlassVein Surface crate — observer & control surface endpoints.
//!
//! A **surface** is a routable client-facing endpoint for management, UI, or
//! control use-cases.  Surfaces sit alongside regular clients in the routing
//! graph but have distinct visibility semantics:
//!
//! - **Observer surface** — subscribes to a stream of [`Observation`]s emitted
//!   when the router processes envelopes.  Observers see all forwarded traffic
//!   (or a filtered subset) but do not inject messages into the graph.
//!
//! - **Control surface** — can send targeted [`ControlCommand`]s (e.g.
//!   `addprompt`) to specific [`SessionAddress`] destinations.
//!
//! Both surface kinds compose `osgp-client` and `osgp`; `core` / `router`
//! do not depend on surface business semantics.

mod control;
mod observer;
mod query;

pub use control::{ControlCommand, ControlResponse, ControlSurface};
pub use observer::{Direction, Observation, ObserverFilter, ObserverSurface, VisibilityScope};
pub use query::{QuerySurface, ResponseStatus};

use osgp::SessionAddress;
use osgp_client::ClientIdentity;

/// A routable surface endpoint in the GlassVein graph.
#[derive(Debug, Clone)]
pub struct SurfaceEndpoint {
    pub identity: ClientIdentity,
}

impl SurfaceEndpoint {
    pub fn new(node_id: impl Into<String>, address: SessionAddress) -> Self {
        Self {
            identity: ClientIdentity {
                node_id: node_id.into(),
                address,
            },
        }
    }
}
