//! Router operator shell — local built-in command line.
//!
//! The operator shell is a local management interface that parses fixed
//! built-in commands. It does **not** execute arbitrary system commands.
//! It calls into the admin handler, route table, rule table, and
//! permission queue.
//!
//! ## Usage
//!
//! The shell can be started via `--operator-shell` or `--admin-shell`
//! CLI flags. It reads commands from stdin and writes output to stdout.
//!
//! ## Commands
//!
//! - `help` — show available commands
//! - `peers` — list connected peers
//! - `peer show <id>` — show peer details
//! - `requests` — list pending permission requests
//! - `approve <id> once|ttl=<secs>|persist` — approve a request
//! - `deny <id>` — deny a request
//! - `routes` — list all routes
//! - `route add <address> via <peer> distance <n>` — add manual route
//! - `route remove <address> [via <peer>]` — remove manual route
//! - `rules` — list all rules
//! - `rule enable|disable|remove <id>` — manage rules
//! - `dry-run ...` — placeholder (returns "not implemented")
//! - `tail` — show recent audit/tap events (placeholder)

#[cfg(test)]
mod tests;

use std::fmt;

// ── ShellCommand ────────────────────────────────────────────────────

/// Parsed operator shell commands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellCommand {
    Help,
    Peers,
    PeerShow { peer_id: String },
    Requests,
    Approve { request_id: String, kind: String },
    Deny { request_id: String },
    Routes,
    RouteAdd { address: String, peer: String, distance: u32 },
    RouteRemove { address: String, peer: Option<String> },
    Rules,
    RuleEnable { rule_id: String },
    RuleDisable { rule_id: String },
    RuleRemove { rule_id: String },
    DryRun { args: String },
    Tail,
    Quit,
    Unknown { input: String },
}

// ── ShellOutput ─────────────────────────────────────────────────────

/// Output from shell command execution.
#[derive(Debug, Clone)]
pub struct ShellOutput {
    pub text: String,
    pub is_error: bool,
}

impl ShellOutput {
    pub fn ok(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: false,
        }
    }

    pub fn error(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            is_error: true,
        }
    }
}

impl fmt::Display for ShellOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.text)
    }
}

// ── Parser ──────────────────────────────────────────────────────────

/// Parse a raw input line into a ShellCommand.
pub fn parse_command(input: &str) -> ShellCommand {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return ShellCommand::Unknown {
            input: trimmed.to_string(),
        };
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    match parts[0] {
        "help" | "?" => ShellCommand::Help,
        "peers" => ShellCommand::Peers,
        "peer" if parts.len() >= 3 && parts[1] == "show" => ShellCommand::PeerShow {
            peer_id: parts[2].to_string(),
        },
        "requests" | "req" => ShellCommand::Requests,
        "approve" if parts.len() >= 3 => ShellCommand::Approve {
            request_id: parts[1].to_string(),
            kind: parts[2..].join(" "),
        },
        "deny" if parts.len() >= 2 => ShellCommand::Deny {
            request_id: parts[1].to_string(),
        },
        "routes" => ShellCommand::Routes,
        "route" if parts.len() >= 2 => match parts[1] {
            "add" if parts.len() >= 6 => {
                // route add <address> via <peer> distance <n>
                let address = parts[2].to_string();
                let peer = parts[4].to_string();
                let distance = parts.get(6).and_then(|s| s.parse().ok()).unwrap_or(0);
                ShellCommand::RouteAdd {
                    address,
                    peer,
                    distance,
                }
            }
            "remove" | "rm" if parts.len() >= 3 => {
                let address = parts[2].to_string();
                let peer = if parts.len() >= 5 && parts[3] == "via" {
                    Some(parts[4].to_string())
                } else {
                    None
                };
                ShellCommand::RouteRemove { address, peer }
            }
            _ => ShellCommand::Unknown {
                input: trimmed.to_string(),
            },
        },
        "rules" => ShellCommand::Rules,
        "rule" if parts.len() >= 3 => match parts[1] {
            "enable" => ShellCommand::RuleEnable {
                rule_id: parts[2].to_string(),
            },
            "disable" => ShellCommand::RuleDisable {
                rule_id: parts[2].to_string(),
            },
            "remove" | "rm" => ShellCommand::RuleRemove {
                rule_id: parts[2].to_string(),
            },
            _ => ShellCommand::Unknown {
                input: trimmed.to_string(),
            },
        },
        "dry-run" | "dryrun" => ShellCommand::DryRun {
            args: parts[1..].join(" "),
        },
        "tail" => ShellCommand::Tail,
        "quit" | "exit" => ShellCommand::Quit,
        _ => ShellCommand::Unknown {
            input: trimmed.to_string(),
        },
    }
}

/// The help text is defined in the executor module.

mod executor;
pub use executor::{PeerInfo, ShellExecutor, HELP_TEXT, parse_address};
