//! Pingora-backed link acceptor and frame IO adapter.
//!
//! This module is compiled only when the `pingora-listener` feature is active.
//! It provides the **compile-ready adapter layer** between core's
//! `PingoraTransport` raw WebSocket text API and router's `link_io` seam.
//!
//! Important boundary:
//!
//! - The router listener path must not consume Pingora connections as
//!   `Box<dyn core::Transport>` because router needs raw JSON frames for
//!   Hello and observer tap messages before/alongside the typed `LinkMessage`
//!   loop.
//! - This file therefore adapts `PingoraTransport::{recv_text, send_text,
//!   close_ws}` to router-local `FrameReader` / `FrameSink`.
//! - Enabling the Cargo feature only compiles this capability; it does not
//!   switch `ConnectionManager::start_listener` away from the default
//!   tokio-tungstenite path.

#![allow(dead_code)]

use std::pin::Pin;
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result};
use async_trait::async_trait;
use gv_core::transport::pingora::{
    build_pingora_service, PingoraServerApp, PingoraTransport, PingoraTransportFactory,
};
use gv_core::transport::TransportFactory;
use pingora_core::server::Server;
use tracing::{info, warn};

use super::config::ListenerConfig;
use super::link_io::{FrameReader, FrameSink, WireFrame};
use super::ConnectionManager;

// ── AcceptedLink ────────────────────────────────────────────────────

/// A router-owned accepted link carrying raw frame IO.
///
/// This is intentionally **not** `Box<dyn core::Transport>`: the router must
/// see raw text frames for Hello and non-`LinkMessage` tap-event JSON.
pub struct AcceptedLink {
    /// Best-effort peer address or diagnostic identifier supplied by core's
    /// Pingora adapter.
    pub peer_addr: String,
    /// Inbound raw text frame reader.
    pub reader: Box<dyn FrameReader + Send>,
    /// Outbound raw text frame sink.
    pub sink: Box<dyn FrameSink + Send>,
}

impl AcceptedLink {
    /// Build an accepted link from a core Pingora transport.
    pub fn from_pingora_transport(transport: PingoraTransport) -> Self {
        let peer_addr = transport.peer_addr().to_owned();
        let transport = Arc::new(transport);

        Self {
            peer_addr,
            reader: Box::new(PingoraFrameReader::new(Arc::clone(&transport))),
            sink: Box::new(PingoraFrameSink::new(transport)),
        }
    }
}

// ── Pingora frame reader/sink ───────────────────────────────────────

/// Router `FrameReader` backed by core `PingoraTransport::recv_text`.
pub struct PingoraFrameReader {
    transport: Arc<PingoraTransport>,
}

impl PingoraFrameReader {
    pub fn new(transport: Arc<PingoraTransport>) -> Self {
        Self { transport }
    }
}

impl FrameReader for PingoraFrameReader {
    fn next_text_frame(
        &mut self,
    ) -> Pin<Box<dyn std::future::Future<Output = Option<Result<WireFrame>>> + Send + '_>> {
        let transport = Arc::clone(&self.transport);
        Box::pin(async move {
            match transport.recv_text().await {
                Ok(Some(text)) => Some(Ok(WireFrame::from_text(text))),
                Ok(None) => None,
                Err(e) => Some(Err(e)),
            }
        })
    }
}

/// Router `FrameSink` backed by core `PingoraTransport::send_text`.
pub struct PingoraFrameSink {
    transport: Arc<PingoraTransport>,
}

impl PingoraFrameSink {
    pub fn new(transport: Arc<PingoraTransport>) -> Self {
        Self { transport }
    }

    /// Close the underlying Pingora WebSocket transport.
    #[allow(dead_code)]
    pub async fn close(&self) -> Result<()> {
        self.transport.close_ws().await
    }
}

impl FrameSink for PingoraFrameSink {
    fn send_frame(
        &mut self,
        frame: WireFrame,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        let transport = Arc::clone(&self.transport);
        Box::pin(async move { transport.send_text(frame.as_text().to_owned()).await })
    }
}

// ── LinkAcceptor trait ──────────────────────────────────────────────

/// Something that yields accepted raw-frame router links.
///
/// `ConnectionManager` can eventually call `accept()` in a loop and hand each
/// `AcceptedLink` to a shared `handle_incoming_link(peer_addr, reader, sink)`
/// path. The current default listener is not switched by this feature.
#[async_trait]
pub trait LinkAcceptor: Send + Sync + 'static {
    /// Accept one incoming connection.
    ///
    /// Returns `Ok(None)` when the listener is shut down.
    async fn accept(&self) -> Result<Option<AcceptedLink>>;
}

// ── PingoraLinkAcceptor ─────────────────────────────────────────────

/// A `LinkAcceptor` backed by core's `PingoraTransportFactory`.
pub struct PingoraLinkAcceptor {
    factory: PingoraTransportFactory,
}

impl PingoraLinkAcceptor {
    /// Create a router acceptor from core's Pingora transport factory.
    pub fn new(factory: PingoraTransportFactory) -> Self {
        Self { factory }
    }
}

#[async_trait]
impl LinkAcceptor for PingoraLinkAcceptor {
    async fn accept(&self) -> Result<Option<AcceptedLink>> {
        self.factory
            .accept()
            .await
            .map(|transport| transport.map(AcceptedLink::from_pingora_transport))
    }
}

// ── ConnectionManager wiring ────────────────────────────────────────

impl ConnectionManager {
    /// Start a Pingora-backed downstream listener.
    ///
    /// This method is compiled only with `pingora-listener`. It starts a
    /// Pingora server on a dedicated OS thread and consumes accepted
    /// `PingoraTransport`s through [`PingoraLinkAcceptor`]. Runtime behavior is
    /// opt-in via `RouterConfig::listener_backend`; default startup remains the
    /// tokio-tungstenite listener.
    pub async fn start_pingora_listener(
        self: &Arc<Self>,
        config: &ListenerConfig,
    ) -> Result<String> {
        let bind_addr = config.bind_addr.clone();
        let node_id = self.node_id.clone();
        let service_name = format!("glassvein-router-{node_id}");

        let (app, factory) = PingoraServerApp::new(node_id.clone());
        let mut service = build_pingora_service(service_name, app);
        service.add_tcp(&bind_addr);

        thread::Builder::new()
            .name(format!("gv-pingora-listener-{node_id}"))
            .spawn(move || {
                let mut server = Server::new(None).expect("create Pingora server");
                server.bootstrap();
                server.add_service(service);
                server.run_forever();
            })
            .with_context(|| format!("spawn Pingora listener thread for {bind_addr}"))?;

        info!(node_id = %self.node_id, addr = %bind_addr, backend = "pingora", "listener started");

        let acceptor = PingoraLinkAcceptor::new(factory);
        let mgr = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let accepted = match acceptor.accept().await {
                    Ok(Some(link)) => link,
                    Ok(None) => {
                        info!(node_id = %mgr.node_id, backend = "pingora", "acceptor closed");
                        break;
                    }
                    Err(e) => {
                        warn!(node_id = %mgr.node_id, error = %e, backend = "pingora", "accept failed");
                        continue;
                    }
                };

                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    let AcceptedLink {
                        peer_addr,
                        reader,
                        sink,
                    } = accepted;
                    let peer_for_log = peer_addr.clone();
                    if let Err(e) = mgr.handle_incoming_link(peer_addr, reader, sink).await {
                        warn!(node_id = %mgr.node_id, peer = %peer_for_log, error = %e, backend = "pingora", "connection failed");
                    }
                });
            }
        });

        Ok(bind_addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pingora_frame_types_implement_router_traits() {
        fn _assert_reader<T: FrameReader + Send>() {}
        fn _assert_sink<T: FrameSink + Send>() {}

        _assert_reader::<PingoraFrameReader>();
        _assert_sink::<PingoraFrameSink>();
    }

    #[test]
    fn pingora_acceptor_implements_link_acceptor() {
        fn _assert_acceptor<T: LinkAcceptor>() {}

        _assert_acceptor::<PingoraLinkAcceptor>();
    }
}
