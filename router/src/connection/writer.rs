//! Writer loops for peer and upstream connections.

use futures_util::SinkExt;
use osgp::LinkMessage;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::warn;

/// Run a plain writer loop (no tap forwarding).
pub(crate) async fn run_plain_writer<W>(
    writer: &mut futures_util::stream::SplitSink<W, Message>,
    rx: &mut mpsc::UnboundedReceiver<LinkMessage>,
) where
    W: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    while let Some(msg) = rx.recv().await {
        let text = match serde_json::to_string(&msg) {
            Ok(t) => t,
            Err(e) => {
                warn!("serialize error: {}", e);
                continue;
            }
        };
        if writer.send(Message::Text(text.into())).await.is_err() {
            break;
        }
    }
}
