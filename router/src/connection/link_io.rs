//! LinkMessage IO seam — transport-agnostic frame read/write abstraction.
//!
//! This module extracts the JSON serialize/deserialize + send/recv logic
//! that was previously hardcoded to `tungstenite::Message` inside `peer.rs`,
//! `upstream.rs`, and `writer.rs`.
//!
//! ## Seam contract
//!
//! - **`WireFrame`**: an opaque text frame on the wire. Carries a JSON-encoded
//!   `LinkMessage` or `HelloMessage` JSON. Decouples from
//!   `tungstenite::Message` so a future Pingora adapter can supply its own
//!   frame type.
//!
//! - **`send_link_message`** / **`recv_link_message`**: free functions that
//!   serialize/deserialize `LinkMessage` to/from `WireFrame`. Both sides of
//!   the IO use these; the transport layer only moves `WireFrame`s.
//!
//! - **`run_plain_writer`**: generic writer loop parameterised over any
//!   `Sink<WireFrame>`. The tungstenite-specific adapter lives in
//!   `TungsteniteFrameSink`.
//!
//! - **`TungsteniteFrameSink`**: default adapter wrapping
//!   `SplitSink<WebSocketStream<_>, Message>`. A future Pingora adapter
//!   would provide an alternative `PingoraFrameSink`.
//!
//! ## Migration path
//!
//! 1. (this phase) Extract seam; all call-sites in `peer.rs`, `upstream.rs`,
//!    `writer.rs` switch to `WireFrame` + adapter.
//! 2. (future) Introduce `PingoraFrameSink` implementing `Sink<WireFrame>`.
//!    No changes to peer registration, dispatch, or route learning.

use std::pin::Pin;

use futures_util::{Sink, SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::warn;

// ── Wire frame ──────────────────────────────────────────────────────

/// A single text frame on the wire.
///
/// Semantically a JSON string. Transport layers move these; the router
/// domain layer serialises/deserialises `LinkMessage` through the
/// helper functions below.
#[derive(Debug, Clone)]
pub struct WireFrame {
    text: String,
}

impl WireFrame {
    /// Create a frame from an arbitrary JSON string.
    pub fn from_text(text: String) -> Self {
        Self { text }
    }

    /// Create a frame by serialising a `LinkMessage`.
    pub fn from_link_message(msg: &LinkMessage) -> Result<Self, serde_json::Error> {
        Ok(Self {
            text: serde_json::to_string(msg)?,
        })
    }

    /// Create a frame by serialising an arbitrary `Serialize` value.
    pub fn from_json<T: serde::Serialize>(value: &T) -> Result<Self, serde_json::Error> {
        Ok(Self {
            text: serde_json::to_string(value)?,
        })
    }

    /// Access the raw text payload.
    pub fn as_text(&self) -> &str {
        &self.text
    }

    /// Deserialize as a `LinkMessage`.
    pub fn to_link_message(&self) -> Result<LinkMessage, serde_json::Error> {
        serde_json::from_str(&self.text)
    }
}

impl std::fmt::Display for WireFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text)
    }
}

// ── Tungstenite adapter ─────────────────────────────────────────────

/// Adapter that wraps a `SplitSink<_, tungstenite::Message>` as a
/// `Sink<WireFrame>`.
///
/// Converts each `WireFrame` to `Message::Text` before forwarding.
pub struct TungsteniteFrameSink<W> {
    inner: futures_util::stream::SplitSink<W, Message>,
}

impl<W> TungsteniteFrameSink<W>
where
    W: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    pub fn new(inner: futures_util::stream::SplitSink<W, Message>) -> Self {
        Self { inner }
    }

    /// Send a `WireFrame` over the tungstenite connection.
    pub async fn send_frame(
        &mut self,
        frame: WireFrame,
    ) -> Result<(), tokio_tungstenite::tungstenite::Error> {
        self.inner.send(Message::Text(frame.text.into())).await
    }

    /// Close the underlying tungstenite connection.
    #[allow(dead_code)]
    pub async fn close(&mut self) -> Result<(), tokio_tungstenite::tungstenite::Error> {
        self.inner.close().await
    }
}

// ── Tungstenite frame reader ────────────────────────────────────────

/// Helper to read `WireFrame`s from a tungstenite `SplitStream`.
pub struct TungsteniteFrameReader<S> {
    inner: futures_util::stream::SplitStream<S>,
}

impl<S> TungsteniteFrameReader<S>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    pub fn new(inner: futures_util::stream::SplitStream<S>) -> Self {
        Self { inner }
    }

    /// Read the next text frame from the tungstenite stream.
    ///
    /// Returns `None` when the stream ends. Non-text frames are skipped.
    pub async fn next_text_frame(
        &mut self,
    ) -> Option<Result<WireFrame, tokio_tungstenite::tungstenite::Error>> {
        while let Some(item) = self.inner.next().await {
            match item {
                Ok(msg) => {
                    if msg.is_text() {
                        return Some(Ok(WireFrame::from_text(msg.to_text().unwrap().to_owned())));
                    }
                    // skip binary, ping, pong, close frames
                }
                Err(e) => return Some(Err(e)),
            }
        }
        None
    }
}

// ── Generic writer loops ────────────────────────────────────────────

/// Run a plain writer loop — forwards `LinkMessage`s from `rx` to the
/// frame sink.
///
/// Generic over any frame sink to allow future Pingora adapter.
pub async fn run_plain_writer<Sink>(sink: &mut Sink, rx: &mut mpsc::UnboundedReceiver<LinkMessage>)
where
    Sink: FrameSink,
{
    while let Some(msg) = rx.recv().await {
        let frame = match WireFrame::from_link_message(&msg) {
            Ok(f) => f,
            Err(e) => {
                warn!("serialize error: {}", e);
                continue;
            }
        };
        if sink.send_frame(frame).await.is_err() {
            break;
        }
    }
}

// ── FrameSink trait ─────────────────────────────────────────────────

/// A sink that can send `WireFrame`s.
///
/// This is the single abstraction point where a future Pingora adapter
/// plugs in. The tungstenite adapter is `TungsteniteFrameSink`.
pub trait FrameSink {
    /// Send a single frame. Returns `Err` if the connection is broken.
    fn send_frame(
        &mut self,
        frame: WireFrame,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(), anyhow::Error>> + Send + '_>>;
}

impl<W> FrameSink for TungsteniteFrameSink<W>
where
    W: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin + Send,
{
    fn send_frame(
        &mut self,
        frame: WireFrame,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(), anyhow::Error>> + Send + '_>> {
        Box::pin(async move {
            self.inner
                .send(Message::Text(frame.text.into()))
                .await
                .map_err(|e| anyhow::anyhow!("frame send: {}", e))
        })
    }
}

impl<T> FrameSink for Box<T>
where
    T: FrameSink + ?Sized,
{
    fn send_frame(
        &mut self,
        frame: WireFrame,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(), anyhow::Error>> + Send + '_>> {
        self.as_mut().send_frame(frame)
    }
}

// ── FrameReader trait ───────────────────────────────────────────────

/// A stream that yields `WireFrame`s.
///
/// Complementary to `FrameSink`. A future Pingora adapter implements
/// this to supply inbound frames.
#[allow(dead_code)]
pub trait FrameReader {
    /// Read the next text frame. Returns `None` on stream end.
    fn next_text_frame(
        &mut self,
    ) -> Pin<
        Box<dyn std::future::Future<Output = Option<Result<WireFrame, anyhow::Error>>> + Send + '_>,
    >;
}

impl<S> FrameReader for TungsteniteFrameReader<S>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Unpin
        + Send,
{
    fn next_text_frame(
        &mut self,
    ) -> Pin<
        Box<dyn std::future::Future<Output = Option<Result<WireFrame, anyhow::Error>>> + Send + '_>,
    > {
        Box::pin(async move {
            loop {
                match self.inner.next().await {
                    None => return None,
                    Some(Ok(msg)) => {
                        if msg.is_text() {
                            return Some(Ok(WireFrame::from_text(
                                msg.to_text().unwrap().to_owned(),
                            )));
                        }
                        // skip non-text
                    }
                    Some(Err(e)) => {
                        return Some(Err(anyhow::anyhow!("frame read: {}", e)));
                    }
                }
            }
        })
    }
}

impl<T> FrameReader for Box<T>
where
    T: FrameReader + ?Sized,
{
    fn next_text_frame(
        &mut self,
    ) -> Pin<
        Box<dyn std::future::Future<Output = Option<Result<WireFrame, anyhow::Error>>> + Send + '_>,
    > {
        self.as_mut().next_text_frame()
    }
}

// ── Convenience: tungstenite split ──────────────────────────────────

/// Split a tungstenite WebSocket stream into a `TungsteniteFrameSink`
/// and `TungsteniteFrameReader`.
///
/// This is the default wiring. A future Pingora adapter would provide
/// its own split function returning Pingora-specific sink/reader.
pub fn split_tungstenite_ws<W>(ws: W) -> (TungsteniteFrameSink<W>, TungsteniteFrameReader<W>)
where
    W: Sink<Message, Error = tokio_tungstenite::tungstenite::Error>
        + futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    let (sink, stream) = ws.split();
    (
        TungsteniteFrameSink::new(sink),
        TungsteniteFrameReader::new(stream),
    )
}
