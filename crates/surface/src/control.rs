//! Control surface — send targeted commands to OSG sessions.
//!
//! A control surface connects as a routable endpoint and can send
//! [`ControlCommand`]s to specific [`SessionAddress`] destinations.
//!
//! ## Visibility rule
//!
//! Control commands are normal [`SessionEnvelope`]s with `link_type`
//! `"control"`.  They are routed through the same graph as any
//! other envelope — only the **target** session receives them.  Regular
//! `Client` endpoints do **not** see control traffic addressed to other
//! sessions; only the targeted endpoint receives the command.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
//! │  Control Surface │───>│  Router Graph    │───>│  Target Client   │
//! │  (Surface role)  │    │  (core decides)  │    │  (Session A)     │
//! └──────────────────┘    └──────────────────┘    └──────────────────┘
//! ```

use osgp::{SessionAddress, SessionEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

// ───────────────────────────── Types ─────────────────────────────

/// A control command targeted at a specific session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum ControlCommand {
    /// Add a prompt/message to a target session.
    AddPrompt {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// The prompt content.
        msg: String,
        /// Optional system info.
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<String>,
        /// Optional source label.
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    /// Abort a target session.
    AbortSession {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// Optional reason.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Compact a target session.
    CompactSession {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// Optional auto-compaction flag.
        #[serde(skip_serializing_if = "Option::is_none")]
        auto: Option<bool>,
    },
    /// Create a new session on a target runtime.
    CreateSession {
        #[serde(rename = "runtimeID")]
        runtime_id: String,
        /// Initial content or prompt for the new session.
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        /// Optional title for the new session.
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    /// Rename a target session.
    RenameSession {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// New title for the session.
        new_title: String,
    },
    /// Resume a target session (e.g. after compaction or abort).
    ResumeSession {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// Optional resume message.
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// Respond to a pending requestion on a target session.
    RequestionRespond {
        #[serde(rename = "sessionID")]
        session_id: String,
        /// Response content.
        response: String,
    },
}

/// Response from a control command execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlResponse {
    /// The command that was executed.
    pub command: String,
    /// Whether execution succeeded.
    pub success: bool,
    /// Optional message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Optional response data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// A control endpoint that can send commands to target sessions.
///
/// The control endpoint wraps a source [`SessionAddress`] and provides
/// convenience methods for building [`SessionEnvelope`]s with control
/// command payloads.  The actual sending is delegated to whatever
/// transport the caller provides.
///
/// ## Cross-domain routing
///
/// Control commands can traverse domain boundaries (cross-domain routing).
/// The source address is used for reply routing so the receiving client
/// knows where to send responses.
pub struct ControlSurface {
    /// The address this control endpoint is registered under.
    pub address: SessionAddress,
    /// The node ID of this control endpoint.
    pub node_id: String,
}

impl ControlSurface {
    /// Create a new control endpoint.
    pub fn new(node_id: impl Into<String>, address: SessionAddress) -> Self {
        Self {
            address,
            node_id: node_id.into(),
        }
    }

    /// Build a [`SessionEnvelope`] containing a [`ControlCommand`].
    ///
    /// The envelope's `source` is set to this endpoint's address, and
    /// `target` is the provided destination.
    ///
    /// The caller is responsible for dispatching the envelope via a transport.
    pub fn build_command_envelope(
        &self,
        target: SessionAddress,
        command: ControlCommand,
    ) -> SessionEnvelope {
        SessionEnvelope {
            id: Uuid::new_v4(),
            source: self.address.clone(),
            target,
            link_type: "control".to_string(),
            subtype: command_subtype(&command).to_string(),
            kind: "session_command".to_string(),
            payload: serde_json::to_value(&command).unwrap_or_default(),
            ttl: 32,
            route_hops: Vec::new(),
            origin_surface: None,
        }
    }

    /// Convenience: build an `addprompt` envelope.
    pub fn build_addprompt(
        &self,
        target: SessionAddress,
        msg: impl Into<String>,
        system: Option<impl Into<String>>,
        source: Option<impl Into<String>>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::AddPrompt {
                session_id: target.session.clone().unwrap_or_default(),
                msg: msg.into(),
                system: system.map(Into::into),
                source: source.map(Into::into),
            },
        )
    }

    /// Convenience: build an `abort` envelope.
    pub fn build_abort(
        &self,
        target: SessionAddress,
        reason: Option<impl Into<String>>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::AbortSession {
                session_id: target.session.clone().unwrap_or_default(),
                reason: reason.map(Into::into),
            },
        )
    }

    /// Convenience: build a `compact` envelope.
    pub fn build_compact(&self, target: SessionAddress, auto: Option<bool>) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::CompactSession {
                session_id: target.session.clone().unwrap_or_default(),
                auto,
            },
        )
    }

    /// Convenience: build a `create_session` envelope.
    ///
    /// `content` is the initial prompt/message for the new session.
    /// `title` is an optional session title.
    /// The runtime is derived from `target.runtime`.
    pub fn build_create_session(
        &self,
        target: SessionAddress,
        content: Option<impl Into<String>>,
        title: Option<impl Into<String>>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target,
            ControlCommand::CreateSession {
                runtime_id: self.address.runtime.clone().unwrap_or_default(),
                content: content.map(Into::into),
                title: title.map(Into::into),
            },
        )
    }

    /// Convenience: build a `rename_session` envelope.
    ///
    /// `new_title` is the desired new title for the target session.
    pub fn build_rename_session(
        &self,
        target: SessionAddress,
        new_title: impl Into<String>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::RenameSession {
                session_id: target.session.clone().unwrap_or_default(),
                new_title: new_title.into(),
            },
        )
    }

    /// Convenience: build a `resume_session` envelope.
    ///
    /// `message` is an optional resume message.
    pub fn build_resume_session(
        &self,
        target: SessionAddress,
        message: Option<impl Into<String>>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::ResumeSession {
                session_id: target.session.clone().unwrap_or_default(),
                message: message.map(Into::into),
            },
        )
    }

    /// Convenience: build a `requestion_respond` envelope.
    ///
    /// `response` is the response content for the pending requestion.
    pub fn build_requestion_respond(
        &self,
        target: SessionAddress,
        response: impl Into<String>,
    ) -> SessionEnvelope {
        self.build_command_envelope(
            target.clone(),
            ControlCommand::RequestionRespond {
                session_id: target.session.clone().unwrap_or_default(),
                response: response.into(),
            },
        )
    }

    /// Parse a [`ControlResponse`] from a reply envelope's payload.
    pub fn parse_response(envelope: &SessionEnvelope) -> Option<ControlResponse> {
        serde_json::from_value(envelope.payload.clone()).ok()
    }
}

fn command_subtype(command: &ControlCommand) -> &'static str {
    match command {
        ControlCommand::AddPrompt { .. } => "add_prompt",
        ControlCommand::AbortSession { .. } => "abort_session",
        ControlCommand::CompactSession { .. } => "compact_session",
        ControlCommand::CreateSession { .. } => "create_session",
        ControlCommand::RenameSession { .. } => "rename_session",
        ControlCommand::ResumeSession { .. } => "resume_session",
        ControlCommand::RequestionRespond { .. } => "requestion_respond",
    }
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests;
