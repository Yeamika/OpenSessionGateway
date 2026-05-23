//! Typed payloads: SessionUpdate, SessionCommand, SessionState, PromptRole, Payload.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::address::SessionId;
use crate::link_type::LinkType;
use crate::validation::ValidationError;

// ── SessionState ─────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Running,
    Active,
    Idle,
    Closed,
}

// ── SessionUpdate ────────────────────────────────────────────────────

/// Session state update payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdate {
    pub session_id: SessionId,
    pub state: SessionState,
    /// Human-readable title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Short summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Arbitrary metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

impl SessionUpdate {
    pub fn subtype(&self) -> &'static str {
        "session_update"
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        self.session_id.validate()?;
        Ok(())
    }
}

// ── SessionCommandKind ───────────────────────────────────────────────

/// Control command subtypes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionCommandKind {
    AddPrompt {
        session_id: SessionId,
    },
    AbortSession {
        session_id: SessionId,
    },
    CompactSession {
        session_id: SessionId,
    },
    CreateSession {
        session_id: SessionId,
    },
    RenameSession {
        session_id: SessionId,
        new_name: String,
    },
    ResumeSession {
        session_id: SessionId,
    },
    RequestionRespond {
        session_id: SessionId,
        requestion_id: String,
    },
}

impl SessionCommandKind {
    pub fn as_wire(&self) -> &'static str {
        match self {
            Self::AddPrompt { .. } => "add_prompt",
            Self::AbortSession { .. } => "abort_session",
            Self::CompactSession { .. } => "compact_session",
            Self::CreateSession { .. } => "create_session",
            Self::RenameSession { .. } => "rename_session",
            Self::ResumeSession { .. } => "resume_session",
            Self::RequestionRespond { .. } => "requestion_respond",
        }
    }
}

// ── SessionCommand ───────────────────────────────────────────────────

/// Control command payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommand {
    /// Optional mirror of subtype for command handlers; not the primary filter field.
    pub command: String,
    /// Canonical control path: `link_type="control"` + `subtype` discriminator.
    pub subtype: SessionCommandKind,
    pub payload: Value,
}

impl SessionCommand {
    pub fn subtype(&self) -> &'static str {
        self.subtype.as_wire()
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        if &self.command != self.subtype.as_wire() {
            return Err(ValidationError::FieldMismatch {
                field: "command".into(),
                reason: "must match subtype".to_string(),
            });
        }
        Ok(())
    }
}

// ── PromptRole ───────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptRole {
    User,
    Assistant,
    System,
}

// ── Payload ──────────────────────────────────────────────────────────

/// Typed envelope payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Payload {
    SessionUpdate(SessionUpdate),
    SessionCommand(SessionCommand),
    Text(Value),
}

impl Payload {
    pub fn link_type(&self) -> LinkType {
        match self {
            Self::SessionUpdate(_) => LinkType::Upload,
            Self::SessionCommand(_) => LinkType::Control,
            Self::Text(_) => LinkType::Upload,
        }
    }

    pub fn subtype(&self) -> String {
        match self {
            Self::SessionUpdate(v) => v.subtype().into(),
            Self::SessionCommand(v) => v.subtype().into(),
            Self::Text(v) => v
                .get("subtype")
                .and_then(|s| s.as_str())
                .unwrap_or("text")
                .into(),
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::SessionUpdate(v) => v.validate(),
            Self::SessionCommand(v) => v.validate(),
            Self::Text(_) => Ok(()),
        }
    }
}
