//! GlassVein routing core.
//!
//! Core owns route tables, transport abstractions, filter rules, tap events,
//! and the forward engine. It must not depend on network transports, clients,
//! router runtimes, surface semantics, npm packaging, or OSG.
//!
//! ## Module layout
//!
//! - [`route`]     — route table, next-hop selection, split-horizon
//! - [`transport`] — `Transport` trait, `InMemoryTransport`, `TransportMap`
//! - [`filter`]    — `FilterRule` trait, built-in filters
//! - [`tap`]       — `TapEvent` enum for structured observation
//! - [`forward`]   — `ForwardEngine`, `ForwardPlan`, `RouteDecision`
//!
//! ## Feature-gated modules
//!
//! - `transport::pingora` — Pingora-backed server transport adapter.
//!   Enabled by the `pingora-transport` Cargo feature (off by default).

pub mod filter;
pub mod forward;
pub mod route;
pub mod tap;
pub mod transport;

// ── Re-exports (backward-compatible public API) ─────────────────────

pub use filter::{FilterContext, FilterDecision, FilterRule};
pub use forward::{ForwardEngine, ForwardMetricsSnapshot, ForwardPlan, RouteDecision};
pub use route::{ForwardDecision, NextHop, RouteAnnouncement, RouteTable};
pub use tap::TapEvent;
pub use transport::{InMemoryTransport, Transport, TransportFactory, TransportMap};
