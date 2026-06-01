//! osgp — OSGP wire types for the Open Session Gateway.
//!
//! Shared session address, envelope, and link/wire message primitives.
//! This crate is the single source of truth for the wire format used
//! between routers, endpoints, and surfaces.
//!
//! ## Crate boundary
//!
//! `osgp` has **no workspace-internal dependencies**. Every other
//! GlassVein crate may depend on it, but it must not depend on them.

pub mod address;
pub mod envelope;
pub mod hello;
pub mod link_type;
pub mod payload;
pub mod read;
pub mod subtype_registry;
pub mod validation;

#[cfg(test)]
mod tests;

// ── Re-exports (public API stays flat) ────────────────────────────────

pub use address::{BroadcastScope, NodeId, RouteTarget, SessionAddress, SessionId};
pub use envelope::{Envelope, LinkMessage, SessionEnvelope};
#[allow(deprecated)]
pub use hello::{HandshakeKind, HelloMessage, LinkHandshake, Role};
pub use link_type::LinkType;
pub use payload::{
    Payload, PromptRole, SessionCommand, SessionCommandKind, SessionState, SessionUpdate,
};
pub use read::{ReadOperation, ReadRequest, ReadResponse, ResponseStatus};
pub use validation::ValidationError;
