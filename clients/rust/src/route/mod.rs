//! Client-side routing adapters.
//!
//! # Core types
//!
//! - [`ClientRouteTransport`] — async transport trait for sending/receiving link messages.
//! - [`LocalClientRoute`] — in-process mini router that manages local sessions via channels
//!   and optionally delegates to an upstream transport for non-local delivery.
//! - [`LocalSession`] — handle to a locally registered session with `send`/`recv`.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────┐
//! │            LocalClientRoute                  │
//! │                                              │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
//! │  │Session A │  │Session B │  │Session C │  │
//! │  │(mpsc tx) │  │(mpsc tx) │  │(mpsc tx) │  │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
//! │       └──────────┬───┘             │         │
//! │          address lookup map        │         │
//! │               │                    │         │
//! └───────────────┼────────────────────┼─────────┘
//!                 │                    │
//!         local delivery        upstream fallback
//!                         (ClientRouteTransport)
//! ```
//!
//! # Module layout
//!
//! - [`transport`] — `ClientRouteTransport` trait, address key helpers
//! - [`local_route`] — `LocalClientRoute`, `LocalSession`, `RouteState`

pub(crate) mod transport;
mod local_route;

// ── Public re-exports ──

pub use local_route::{LocalClientRoute, LocalSession};
pub use transport::ClientRouteTransport;
