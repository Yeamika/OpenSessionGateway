//! Control message builder for the console endpoint.
//!
//! Builds control envelopes for canonical session commands. These are
//! **outbound** messages sent from the console to a runtime endpoint.
//!
//! ## Canonical Control Subtypes
//!
//! The following control subtypes are recognized:
//! - `add_prompt` — Send a prompt to a session
//! - `abort_session` — Abort a running session
//! - `compact_session` — Compact session history
//! - `create_session` — Create a new session
//! - `rename_session` — Rename a session
//! - `resume_session` — Resume a paused session
//! - `requestion_respond` — Respond to a pending requestion

use anyhow::{bail, Result};
use osgp::{SessionAddress, SessionEnvelope};
use surface::ControlSurface;

/// Build a control envelope for a canonical control command.
///
/// Returns an error if the command is not in the canonical control subtype list.
pub fn build_control(
    command: &str,
    source_node_id: &str,
    source: SessionAddress,
    target: SessionAddress,
    message: &str,
) -> Result<SessionEnvelope> {
    let surface = ControlSurface::new(source_node_id, source);
    let envelope = match command {
        "add_prompt" => {
            surface.build_addprompt(target, message, Some("console-endpoint"), None::<String>)
        }
        "abort_session" => surface.build_abort(target, text_opt(message)),
        "compact_session" => surface.build_compact(target, Some(true)),
        "resume_session" => surface.build_resume_session(target, text_opt(message)),
        "rename_session" => surface.build_rename_session(target, message),
        "create_session" => surface.build_create_session(target, text_opt(message), None::<String>),
        other => bail!("unsupported control command '{other}'"),
    };
    Ok(envelope)
}

fn text_opt(value: &str) -> Option<&str> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
