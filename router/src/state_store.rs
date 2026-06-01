//! Local JSON state persistence for the router.
//!
//! Persists manual routes, forward rules, persistent grants, and a bounded
//! audit log to a JSON file. Learned routes, current peers, and temporary
//! grants are **not** persisted.
//!
//! ## Atomic writes
//!
//! Writes use temp-file + rename to avoid corruption on crash.
//!
//! ## File permissions
//!
//! On Unix, the state file is created with mode `0600` if the platform
//! supports it.

#[cfg(test)]
mod tests;
mod types;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::{debug, info, warn};

pub use types::{RouterState, SerializedRouteEntry, SerializedRule};

// ── StateStore ──────────────────────────────────────────────────────

/// A simple JSON file-backed state store.
pub struct StateStore {
    path: Option<PathBuf>,
}

impl StateStore {
    /// Create a store with an explicit path. If `None`, persistence is
    /// disabled (all operations become no-ops).
    pub fn new(path: Option<PathBuf>) -> Self {
        Self { path }
    }

    /// Load state from disk. Returns `Default::default()` if the file
    /// does not exist or is unreadable.
    pub fn load(&self) -> RouterState {
        let Some(path) = &self.path else {
            return RouterState::default();
        };
        match std::fs::read_to_string(path) {
            Ok(data) => match serde_json::from_str::<RouterState>(&data) {
                Ok(state) => {
                    info!(path = %path.display(), "state loaded from disk");
                    state
                }
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "failed to parse state file, using defaults");
                    RouterState::default()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                debug!(path = %path.display(), "state file not found, using defaults");
                RouterState::default()
            }
            Err(e) => {
                warn!(path = %path.display(), error = %e, "failed to read state file, using defaults");
                RouterState::default()
            }
        }
    }

    /// Save state to disk atomically (temp file + rename).
    pub fn save(&self, state: &RouterState) -> Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let json = serde_json::to_string_pretty(state)
            .context("failed to serialize state")?;

        // Write to temp file in same directory
        let tmp_path = path.with_extension("json.tmp");
        std::fs::write(&tmp_path, &json)
            .with_context(|| format!("failed to write temp file: {}", tmp_path.display()))?;

        // Atomic rename
        std::fs::rename(&tmp_path, path)
            .with_context(|| format!("failed to rename {} → {}", tmp_path.display(), path.display()))?;

        // Set permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = std::fs::set_permissions(path, perms);
            }
        }

        debug!(path = %path.display(), "state saved to disk");
        Ok(())
    }

    /// The configured path, if any.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}
