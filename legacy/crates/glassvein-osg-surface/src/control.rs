//! Control Surface — send control commands to OSG clients/sessions
//! via the GlassVein routing network.
//!
//! The control surface connects to a GlassVein router as a `Surface` role
//! and can send targeted control commands (e.g., `addprompt`) to specific
//! runtime/session addresses.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use glassvein_protocol::{NodeRole, RouteAddress, RouteAnnouncement, RouteEnvelope, WireMessage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::info;

// ───────────────────────────── Types ─────────────────────────────

/// Configuration for a control surface connection.
#[derive(Clone, Debug)]
pub struct ControlSurfaceConfig {
    /// Unique identifier for this control surface instance.
    pub node_id: String,
    /// GlassVein router WebSocket URL to connect to.
    pub router_url: String,
    /// Route address for this control surface.
    pub route: RouteAddress,
}

/// A control command that can be sent to a target client/session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum ControlCommand {
    /// Add a prompt/message to a target session.
    AddPrompt {
        /// The prompt content/message to add.
        msg: String,
        /// Optional system info to include.
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<String>,
        /// Optional source label.
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    /// Abort a target session.
    Abort {
        /// Optional reason for aborting.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Compact a target session.
    Compact {
        /// Optional auto-compaction flag.
        #[serde(skip_serializing_if = "Option::is_none")]
        auto: Option<bool>,
    },
}

/// Response received from a control command execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlResponse {
    /// The original command type.
    pub command: String,
    /// Whether the command was successful.
    pub success: bool,
    /// Optional response message or error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Optional response payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

// ───────────────────────────── ControlSurface ────────────────────

/// A control surface that can send commands to OSG clients/sessions.
pub struct ControlSurface {
    config: ControlSurfaceConfig,
    tx: mpsc::UnboundedSender<WireMessage>,
    _writer_task: tokio::task::JoinHandle<()>,
}

impl ControlSurface {
    /// Connect to a GlassVein router and establish a control surface.
    pub async fn connect(config: ControlSurfaceConfig) -> Result<Self> {
        info!(
            node_id = %config.node_id,
            router_url = %config.router_url,
            route = %config.route.key(),
            "connecting control surface"
        );

        let (ws, _) = connect_async(&config.router_url)
            .await
            .with_context(|| format!("connect control surface to {}", config.router_url))?;

        let (mut writer, _reader) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<WireMessage>();

        // Spawn writer task
        let writer_task = tokio::spawn(async move {
            while let Some(message) = rx.recv().await {
                let Ok(text) = serde_json::to_string(&message) else {
                    continue;
                };
                if writer.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        // Send hello with Surface role
        let hello = WireMessage::Hello {
            node_id: config.node_id.clone(),
            role: NodeRole::Surface,
            routes: vec![RouteAnnouncement::local(config.route.clone())],
        };
        tx.send(hello)?;

        info!(
            node_id = %config.node_id,
            "control surface connected and registered"
        );

        Ok(Self {
            config,
            tx,
            _writer_task: writer_task,
        })
    }

    /// Send a control command to a target address.
    pub fn send_command(
        &self,
        target: RouteAddress,
        command: ControlCommand,
    ) -> Result<String> {
        let envelope = RouteEnvelope::new(
            self.config.route.clone(),
            target.clone(),
            "control.command",
            json!({
                "command": command,
                "source": self.config.node_id,
            }),
        );

        let message_id = envelope.message_id.clone();

        info!(
            source = %self.config.route.key(),
            target = %target.key(),
            command_type = %match &command {
                ControlCommand::AddPrompt { .. } => "addprompt",
                ControlCommand::Abort { .. } => "abort",
                ControlCommand::Compact { .. } => "compact",
            },
            message_id = %message_id,
            "sending control command"
        );

        self.tx.send(WireMessage::Envelope {
            envelope: Box::new(envelope),
        })?;

        Ok(message_id)
    }

    /// Convenience: send an addprompt command to a target runtime/session.
    pub fn send_addprompt(
        &self,
        target: RouteAddress,
        msg: impl Into<String>,
        system: Option<impl Into<String>>,
        source: Option<impl Into<String>>,
    ) -> Result<String> {
        self.send_command(
            target,
            ControlCommand::AddPrompt {
                msg: msg.into(),
                system: system.map(Into::into),
                source: source.map(Into::into),
            },
        )
    }

    /// Get the route address of this control surface.
    pub fn route(&self) -> &RouteAddress {
        &self.config.route
    }

    /// Get the node ID of this control surface.
    pub fn node_id(&self) -> &str {
        &self.config.node_id
    }
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_command_addprompt_serialization() {
        let cmd = ControlCommand::AddPrompt {
            msg: "Hello, session!".to_string(),
            system: Some("test-system".to_string()),
            source: Some("test-source".to_string()),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"command\":\"addprompt\""));
        assert!(json.contains("\"msg\":\"Hello, session!\""));
        assert!(json.contains("\"system\":\"test-system\""));
        assert!(json.contains("\"source\":\"test-source\""));
    }

    #[test]
    fn control_command_abort_serialization() {
        let cmd = ControlCommand::Abort {
            reason: Some("test abort".to_string()),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"command\":\"abort\""));
        assert!(json.contains("\"reason\":\"test abort\""));
    }

    #[test]
    fn control_command_compact_serialization() {
        let cmd = ControlCommand::Compact {
            auto: Some(true),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"command\":\"compact\""));
        assert!(json.contains("\"auto\":true"));
    }

    #[test]
    fn control_response_deserialization() {
        let json_str = r#"{
            "command": "addprompt",
            "success": true,
            "message": "Command executed",
            "data": {"result": "ok"}
        }"#;

        let response: ControlResponse = serde_json::from_str(json_str).unwrap();
        assert_eq!(response.command, "addprompt");
        assert!(response.success);
        assert_eq!(response.message.as_deref(), Some("Command executed"));
        assert!(response.data.is_some());
    }
}
