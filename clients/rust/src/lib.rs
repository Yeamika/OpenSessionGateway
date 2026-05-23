//! OSGP Client SDK — transport, routing, and session management.
//!
//! This crate provides:
//! - `Transport` trait for abstracting the underlying network layer
//! - `FakeTransport` for in-memory demo/testing
//! - `WebSocketTransportHandle` for real WebSocket connections
//! - `Client` with connect/register/send/receive API
//! - `LocalClientRoute` for in-process session routing
//! - Integration with `osgp` types (Envelope, SessionAddress, etc.)
//!
//! # Module layout
//!
//! - [`transport`] — `Transport` trait, `FakeTransportHub`, `FakeTransportHandle`
//! - [`ws_transport`] — `WebSocketTransport`, `WebSocketTransportHandle`
//! - [`client`] — `ClientIdentity`, `ClientConfig`, `ClientState`, `Client<T>`
//! - [`helpers`] — convenience constructors
//! - [`route`] — `ClientRouteTransport`, `LocalClientRoute`, `LocalSession`

mod transport;
mod ws_transport;
mod client;
mod helpers;
mod route;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod route_tests;

// ── Public re-exports ──

pub use client::{Client, ClientConfig, ClientIdentity, ClientState};
pub use helpers::{create_fake_client, create_ws_client};
pub use route::{ClientRouteTransport, LocalClientRoute, LocalSession};
pub use transport::{FakeTransportHandle, FakeTransportHub, Transport};
pub use ws_transport::{WebSocketTransport, WebSocketTransportHandle};
