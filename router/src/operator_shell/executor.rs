use super::{ShellCommand, ShellOutput};

pub const HELP_TEXT: &str = "\
Available commands:
  help                                Show this help
  peers                               List connected peers
  peer show <id>                      Show peer details
  requests                            List pending permission requests
  approve <id> once|ttl=<secs>|persist Approve a permission request
  deny <id>                           Deny a permission request
  routes                              List all routes
  route add <addr> via <peer> dist <n> Add manual route
  route remove <addr> [via <peer>]    Remove manual route
  rules                               List all rules
  rule enable|disable|remove <id>     Manage rules
  dry-run <envelope-json>             Evaluate rules against envelope
  tail                                Show recent audit/tap events
  quit                                Exit the shell";

// ── PeerInfo ────────────────────────────────────────────────────────

/// Lightweight peer info for shell display.
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub peer_id: String,
    pub role: String,
    pub connected: bool,
    pub capabilities: Vec<String>,
}

// ── ShellExecutor ───────────────────────────────────────────────────

/// Executes parsed shell commands by calling into AdminHandler,
/// PermissionQueue, and peer registry.
///
/// Holds `Arc` references so it can be cheaply cloned and used from
/// async contexts.
pub struct ShellExecutor {
    pub admin: crate::admin::AdminHandler,
    pub permissions: std::sync::Arc<tokio::sync::RwLock<gv_core::PermissionQueue>>,
    pub audit_buffer: std::sync::Arc<tokio::sync::RwLock<Vec<String>>>,
    /// Function to get current peer list. Called synchronously.
    pub peer_info_fn: std::sync::Arc<dyn Fn() -> Vec<PeerInfo> + Send + Sync>,
}

impl ShellExecutor {
    /// Execute a parsed command and return output.
    pub async fn execute(&self, cmd: ShellCommand) -> ShellOutput {
        match cmd {
            ShellCommand::Help => ShellOutput::ok(HELP_TEXT),

            ShellCommand::Peers => {
                let peers = (self.peer_info_fn)();
                if peers.is_empty() {
                    return ShellOutput::ok("No connected peers.");
                }
                let mut lines = vec![format!("{:<20} {:<10} {}", "PEER_ID", "ROLE", "CONNECTED")];
                for p in &peers {
                    lines.push(format!(
                        "{:<20} {:<10} {}",
                        p.peer_id,
                        p.role,
                        if p.connected { "yes" } else { "no" }
                    ));
                }
                ShellOutput::ok(lines.join("\n"))
            }

            ShellCommand::PeerShow { peer_id } => {
                let peers = (self.peer_info_fn)();
                match peers.iter().find(|p| p.peer_id == peer_id) {
                    Some(p) => {
                        let caps = if p.capabilities.is_empty() {
                            "none".to_string()
                        } else {
                            p.capabilities.join(", ")
                        };
                        ShellOutput::ok(format!(
                            "Peer: {}\nRole: {}\nConnected: {}\nCapabilities: {}",
                            p.peer_id,
                            p.role,
                            if p.connected { "yes" } else { "no" },
                            caps
                        ))
                    }
                    None => ShellOutput::error(format!("Peer '{}' not found.", peer_id)),
                }
            }

            ShellCommand::Requests => {
                let perms = self.permissions.read().await;
                let pending = perms.pending();
                if pending.is_empty() {
                    return ShellOutput::ok("No pending requests.");
                }
                let mut lines = vec![format!("{:<12} {:<20} {}", "REQUEST_ID", "PEER_ID", "OP")];
                for r in &pending {
                    lines.push(format!("{:<12} {:<20} {}", r.id, r.peer_id, r.op.as_str()));
                }
                ShellOutput::ok(lines.join("\n"))
            }

            ShellCommand::Approve {
                request_id,
                kind,
            } => {
                let approval = match kind.as_str() {
                    "once" => gv_core::ApprovalKind::Once,
                    "persist" => gv_core::ApprovalKind::Persist,
                    s if s.starts_with("ttl=") => {
                        let secs = s.strip_prefix("ttl=").unwrap_or("0");
                        match secs.parse::<u64>() {
                            Ok(n) => gv_core::ApprovalKind::Ttl { seconds: n },
                            Err(_) => {
                                return ShellOutput::error(format!(
                                    "Invalid TTL: '{}'",
                                    secs
                                ));
                            }
                        }
                    }
                    _ => {
                        return ShellOutput::error(format!(
                            "Unknown approval kind: '{}'. Use: once, ttl=<seconds>, persist",
                            kind
                        ));
                    }
                };
                let mut perms = self.permissions.write().await;
                if perms.approve(&request_id, approval) {
                    ShellOutput::ok(format!("Request '{}' approved ({}).", request_id, kind))
                } else {
                    ShellOutput::error(format!(
                        "Request '{}' not found or already resolved.",
                        request_id
                    ))
                }
            }

            ShellCommand::Deny { request_id } => {
                let mut perms = self.permissions.write().await;
                if perms.deny(&request_id) {
                    ShellOutput::ok(format!("Request '{}' denied.", request_id))
                } else {
                    ShellOutput::error(format!(
                        "Request '{}' not found or already resolved.",
                        request_id
                    ))
                }
            }

            ShellCommand::Routes => {
                let resp = self.admin.handle(crate::admin::AdminRequest::RouteList).await;
                if resp.ok {
                    ShellOutput::ok(serde_json::to_string_pretty(&resp.data).unwrap_or_default())
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::RouteAdd {
                address,
                peer,
                distance,
            } => {
                let addr = match parse_address(&address) {
                    Ok(a) => a,
                    Err(e) => return ShellOutput::error(e),
                };
                let resp = self
                    .admin
                    .handle(crate::admin::AdminRequest::RouteAdd {
                        address: addr,
                        neighbor: peer,
                        distance,
                    })
                    .await;
                if resp.ok {
                    ShellOutput::ok(format!(
                        "Route added. {}",
                        serde_json::to_string(&resp.data).unwrap_or_default()
                    ))
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::RouteRemove { address, peer } => {
                let addr = match parse_address(&address) {
                    Ok(a) => a,
                    Err(e) => return ShellOutput::error(e),
                };
                let neighbor = peer.unwrap_or_default();
                let resp = self
                    .admin
                    .handle(crate::admin::AdminRequest::RouteRemove {
                        address: addr,
                        neighbor,
                    })
                    .await;
                if resp.ok {
                    ShellOutput::ok(format!(
                        "Route removed. {}",
                        serde_json::to_string(&resp.data).unwrap_or_default()
                    ))
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::Rules => {
                let resp = self.admin.handle(crate::admin::AdminRequest::RuleList).await;
                if resp.ok {
                    ShellOutput::ok(serde_json::to_string_pretty(&resp.data).unwrap_or_default())
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::RuleEnable { rule_id } => {
                let resp = self
                    .admin
                    .handle(crate::admin::AdminRequest::RuleEnable { id: rule_id.clone() })
                    .await;
                if resp.ok {
                    ShellOutput::ok(format!("Rule '{}' enabled.", rule_id))
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::RuleDisable { rule_id } => {
                let resp = self
                    .admin
                    .handle(crate::admin::AdminRequest::RuleDisable { id: rule_id.clone() })
                    .await;
                if resp.ok {
                    ShellOutput::ok(format!("Rule '{}' disabled.", rule_id))
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::RuleRemove { rule_id } => {
                let resp = self
                    .admin
                    .handle(crate::admin::AdminRequest::RuleRemove { id: rule_id.clone() })
                    .await;
                if resp.ok {
                    ShellOutput::ok(format!("Rule '{}' removed.", rule_id))
                } else {
                    ShellOutput::error(resp.error.unwrap_or_default())
                }
            }

            ShellCommand::DryRun { args } => {
                // Parse envelope JSON from args
                let trimmed = args.trim();
                if trimmed.is_empty() {
                    return ShellOutput::error(
                        "Usage: dry-run <envelope-json> [from <neighbor>]\n\
                         Example: dry-run '{\"source\":...,\"target\":...}' from n1",
                    );
                }
                // Try to extract envelope JSON and optional "from <neighbor>"
                let (env_json, from_neighbor) = if let Some(pos) = trimmed.find(" from ") {
                    let json_part = &trimmed[..pos];
                    let neighbor = trimmed[pos + 6..].trim().to_string();
                    (json_part, Some(neighbor))
                } else {
                    (trimmed, None)
                };

                match serde_json::from_str::<osgp::SessionEnvelope>(env_json) {
                    Ok(envelope) => {
                        // Evaluate against rule table
                        let rule_ctx = gv_core::RuleContext {
                            source: &envelope.source,
                            target: &envelope.target,
                            link_type: &envelope.link_type,
                            subtype: &envelope.subtype,
                            kind: &envelope.kind,
                            from_neighbor: from_neighbor.as_deref(),
                            ttl: envelope.ttl,
                        };
                        let rule_table = self.admin.rule_table().read().await;
                        let route_table = self.admin.route_table().read().await;

                        let mut output = String::new();
                        output.push_str("=== Dry Run ===\n");

                        // Rule evaluation
                        match rule_table.evaluate(&rule_ctx) {
                            Some(action) => {
                                output.push_str(&format!("Rule match: {:?}\n", action));
                            }
                            None => {
                                output.push_str("Rule match: none (Continue)\n");
                            }
                        }

                        // Route resolution
                        let decision = route_table.decide_for_target(
                            &envelope.target,
                            from_neighbor.as_deref(),
                        );
                        output.push_str(&format!("Route decision: {:?}\n", decision.next_hop));

                        ShellOutput::ok(output)
                    }
                    Err(e) => ShellOutput::error(format!("Invalid envelope JSON: {}", e)),
                }
            }

            ShellCommand::Tail => {
                let buffer = self.audit_buffer.read().await;
                if buffer.is_empty() {
                    return ShellOutput::ok("No recent events.");
                }
                let lines: Vec<&str> = buffer.iter().map(|s| s.as_str()).collect();
                ShellOutput::ok(lines.join("\n"))
            }

            ShellCommand::Quit => ShellOutput::ok("Bye."),

            ShellCommand::Unknown { input } => {
                ShellOutput::error(format!("Unknown command: '{}'. Type 'help' for usage.", input))
            }
        }
    }
}

/// Parse a slash-delimited address string into a SessionAddress.
/// Format: "domain" or "domain/runtime" or "domain/runtime/session".
pub fn parse_address(s: &str) -> Result<osgp::SessionAddress, String> {
    let parts: Vec<&str> = s.split('/').collect();
    match parts.len() {
        1 => Ok(osgp::SessionAddress::new(parts[0], None, None)),
        2 => Ok(osgp::SessionAddress::new(
            parts[0],
            Some(parts[1].to_string()),
            None,
        )),
        3 => Ok(osgp::SessionAddress::new(
            parts[0],
            Some(parts[1].to_string()),
            Some(parts[2].to_string()),
        )),
        _ => Err(format!(
            "Invalid address format: '{}'. Use: domain or domain/runtime or domain/runtime/session",
            s
        )),
    }
}
