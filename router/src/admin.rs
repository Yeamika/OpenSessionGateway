//! Admin plane handler — validates and applies admin requests to the
//! router's RouteTable and RuleTable.
//!
//! The handler is a pure function: `AdminRequest` + table references →
//! `AdminResponse`. It does not own any network state. The router layer
//! is responsible for parsing admin envelopes and calling the handler.
//!
//! ## Extension points (not implemented in MVP)
//!
//! - Capability enforcement: check caller identity before applying.
//! - Dry-run: evaluate rules against an envelope without applying.
//! - Audit: persist admin actions to an audit log.
//! - Optimistic concurrency: reject mutations when `base_revision` is stale.

#[cfg(test)]
mod tests;
mod types;

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::RwLock;
use tracing::info;

use gv_core::{
    RouteTable, Rule, RuleAction, RuleMatcher, RuleTable,
};
use osgp::SessionAddress;

pub use types::{AdminRequest, AdminResponse, AdminRuleDef};

// ── AdminHandler ────────────────────────────────────────────────────

/// Handles admin requests by mutating the shared RouteTable and RuleTable.
///
/// Designed to be cheaply cloneable (all state is behind `Arc<RwLock>`).
#[derive(Clone)]
pub struct AdminHandler {
    route_table: Arc<RwLock<RouteTable>>,
    rule_table: Arc<RwLock<RuleTable>>,
    router_id: String,
}

impl AdminHandler {
    pub fn new(
        router_id: String,
        route_table: Arc<RwLock<RouteTable>>,
        rule_table: Arc<RwLock<RuleTable>>,
    ) -> Self {
        Self {
            route_table,
            rule_table,
            router_id,
        }
    }

    /// Access the shared route table.
    pub fn route_table(&self) -> &Arc<RwLock<RouteTable>> {
        &self.route_table
    }

    /// Access the shared rule table.
    pub fn rule_table(&self) -> &Arc<RwLock<RuleTable>> {
        &self.rule_table
    }

    // ── Dispatch ───────────────────────────────────────────────────

    /// Process an admin request and return a response.
    pub async fn handle(&self, request: AdminRequest) -> AdminResponse {
        let result = match request {
            // ── Route management ───────────────────────────────────
            AdminRequest::RouteList => {
                let table = self.route_table.read().await;
                let entries = table.list_all();
                let values: Vec<Value> = entries
                    .iter()
                    .map(|e| {
                        json!({
                            "address": format_address(&e.address),
                            "neighbor": e.neighbor,
                            "distance": e.distance,
                            "origin": format!("{:?}", e.origin).to_lowercase(),
                        })
                    })
                    .collect();
                Ok(json!({ "routes": values, "revision": table.revision() }))
            }

            AdminRequest::RouteListByNeighbor { neighbor } => {
                let table = self.route_table.read().await;
                let entries = table.list_by_neighbor(&neighbor);
                let values: Vec<Value> = entries
                    .iter()
                    .map(|e| {
                        json!({
                            "address": format_address(&e.address),
                            "distance": e.distance,
                            "origin": format!("{:?}", e.origin).to_lowercase(),
                        })
                    })
                    .collect();
                Ok(json!({ "routes": values, "neighbor": neighbor }))
            }

            AdminRequest::RouteListManual => {
                let table = self.route_table.read().await;
                let entries = table.list_manual();
                let values: Vec<Value> = entries
                    .iter()
                    .map(|e| {
                        json!({
                            "address": format_address(&e.address),
                            "neighbor": e.neighbor,
                            "distance": e.distance,
                        })
                    })
                    .collect();
                Ok(json!({ "routes": values }))
            }

            AdminRequest::RouteAdd {
                address,
                neighbor,
                distance,
            } => {
                let mut table = self.route_table.write().await;
                let changed = table.insert_manual(address.clone(), &neighbor, distance);
                let revision = table.revision();
                info!(
                    router = %self.router_id,
                    address = %format_address(&address),
                    neighbor = %neighbor,
                    distance,
                    changed,
                    "admin: route add (manual)"
                );
                Ok(json!({ "changed": changed, "revision": revision }))
            }

            AdminRequest::RouteRemove { address, neighbor } => {
                let mut table = self.route_table.write().await;
                let removed = table.remove_manual(&address, &neighbor);
                let revision = table.revision();
                info!(
                    router = %self.router_id,
                    address = %format_address(&address),
                    neighbor = %neighbor,
                    removed,
                    "admin: route remove (manual)"
                );
                Ok(json!({ "removed": removed, "revision": revision }))
            }

            // ── Rule management ────────────────────────────────────
            AdminRequest::RuleList => {
                let table = self.rule_table.read().await;
                let snap = table.snapshot();
                let values: Vec<Value> = snap
                    .iter()
                    .map(|r| {
                        json!({
                            "id": r.id,
                            "priority": r.priority,
                            "enabled": r.enabled,
                            "action": r.action_summary,
                            "revision": r.revision,
                        })
                    })
                    .collect();
                Ok(json!({ "rules": values, "revision": table.revision() }))
            }

            AdminRequest::RuleAdd { rule_def } => {
                let rule = Rule {
                    id: rule_def.id.clone(),
                    priority: rule_def.priority,
                    enabled: rule_def.enabled,
                    matcher: RuleMatcher {
                        source_address: rule_def.source_address.clone(),
                        target_address: rule_def.target_address.clone(),
                        link_type: rule_def.link_type.clone(),
                        subtype: rule_def.subtype.clone(),
                        kind: rule_def.kind.clone(),
                        from_neighbor: rule_def.from_neighbor.clone(),
                        ttl_min: rule_def.ttl_min,
                        ttl_max: rule_def.ttl_max,
                    },
                    action: match rule_def.action.as_str() {
                        s if s.starts_with("drop:") => RuleAction::Drop {
                            reason: s.strip_prefix("drop:").unwrap_or("").trim().to_string(),
                        },
                        s if s.starts_with("force:") => RuleAction::ForceNeighbor {
                            neighbor_id: s.strip_prefix("force:").unwrap_or("").trim().to_string(),
                        },
                        s if s.starts_with("deny:") => RuleAction::DenyNeighbor {
                            neighbor_id: s.strip_prefix("deny:").unwrap_or("").trim().to_string(),
                        },
                        "continue" => RuleAction::Continue,
                        other => {
                            return AdminResponse::error(format!(
                                "unknown action format: '{other}' (expected drop:<reason>, force:<id>, deny:<id>, continue)"
                            ))
                        }
                    },
                    revision: 0,
                };
                let mut table = self.rule_table.write().await;
                let rule_id = rule.id.clone();
                table.add_rule(rule);
                let revision = table.revision();
                info!(
                    router = %self.router_id,
                    rule_id = %rule_id,
                    revision,
                    "admin: rule add"
                );
                Ok(json!({ "added": true, "revision": revision }))
            }

            AdminRequest::RuleRemove { id } => {
                let mut table = self.rule_table.write().await;
                let removed = table.remove_rule(&id);
                let revision = table.revision();
                info!(
                    router = %self.router_id,
                    rule_id = %id,
                    removed,
                    "admin: rule remove"
                );
                Ok(json!({ "removed": removed, "revision": revision }))
            }

            AdminRequest::RuleEnable { id } => {
                let mut table = self.rule_table.write().await;
                let changed = table.enable_rule(&id);
                let revision = table.revision();
                Ok(json!({ "changed": changed, "revision": revision }))
            }

            AdminRequest::RuleDisable { id } => {
                let mut table = self.rule_table.write().await;
                let changed = table.disable_rule(&id);
                let revision = table.revision();
                Ok(json!({ "changed": changed, "revision": revision }))
            }

            // ── Query ──────────────────────────────────────────────
            AdminRequest::Revision => {
                let route_rev = self.route_table.read().await.revision();
                let rule_rev = self.rule_table.read().await.revision();
                Ok(json!({
                    "route_revision": route_rev,
                    "rule_revision": rule_rev,
                }))
            }

            AdminRequest::DryRun { .. } => {
                // Extension point: not implemented in MVP.
                Err("dry-run not yet implemented".to_string())
            }
        };

        match result {
            Ok(data) => AdminResponse::ok(data),
            Err(message) => AdminResponse::error(message),
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn format_address(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}
