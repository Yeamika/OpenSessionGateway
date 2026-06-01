//! Admin handler tests.

use std::sync::Arc;

use serde_json::json;
use tokio::sync::RwLock;

use gv_core::{RouteTable, RuleTable};
use osgp::SessionAddress;

use super::*;
use crate::admin::types::{AdminRuleDef, AdminRequest, AdminResponse};

fn make_handler() -> AdminHandler {
    let route_table = Arc::new(RwLock::new(RouteTable::default()));
    let rule_table = Arc::new(RwLock::new(RuleTable::default()));
    AdminHandler::new("test-router".into(), route_table, rule_table)
}

fn addr(domain: &str, runtime: Option<&str>, session: Option<&str>) -> SessionAddress {
    SessionAddress::new(
        domain,
        runtime.map(String::from),
        session.map(String::from),
    )
}

// ── Route management ────────────────────────────────────────────────

#[tokio::test]
async fn route_list_empty() {
    let handler = make_handler();
    let resp = handler.handle(AdminRequest::RouteList).await;
    assert!(resp.ok);
    let data = resp.data.unwrap();
    assert_eq!(data["routes"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn route_add_and_list() {
    let handler = make_handler();
    let d1 = addr("d1", None, None);

    let resp = handler
        .handle(AdminRequest::RouteAdd {
            address: d1.clone(),
            neighbor: "n1".into(),
            distance: 5,
        })
        .await;
    assert!(resp.ok);
    assert!(resp.data.as_ref().unwrap()["changed"].as_bool().unwrap());

    let resp = handler.handle(AdminRequest::RouteList).await;
    assert!(resp.ok);
    let routes = resp.data.unwrap()["routes"].as_array().unwrap().clone();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["neighbor"], "n1");
    assert_eq!(routes[0]["origin"], "manual");
}

#[tokio::test]
async fn route_remove() {
    let handler = make_handler();
    let d1 = addr("d1", None, None);

    handler
        .handle(AdminRequest::RouteAdd {
            address: d1.clone(),
            neighbor: "n1".into(),
            distance: 5,
        })
        .await;

    let resp = handler
        .handle(AdminRequest::RouteRemove {
            address: d1,
            neighbor: "n1".into(),
        })
        .await;
    assert!(resp.ok);
    assert!(resp.data.as_ref().unwrap()["removed"].as_bool().unwrap());

    let resp = handler.handle(AdminRequest::RouteList).await;
    assert_eq!(
        resp.data.unwrap()["routes"].as_array().unwrap().len(),
        0
    );
}

#[tokio::test]
async fn route_remove_nonexistent() {
    let handler = make_handler();
    let resp = handler
        .handle(AdminRequest::RouteRemove {
            address: addr("d1", None, None),
            neighbor: "nobody".into(),
        })
        .await;
    assert!(resp.ok);
    assert!(!resp.data.as_ref().unwrap()["removed"].as_bool().unwrap());
}

#[tokio::test]
async fn route_list_by_neighbor() {
    let handler = make_handler();

    handler
        .handle(AdminRequest::RouteAdd {
            address: addr("d1", None, None),
            neighbor: "n1".into(),
            distance: 1,
        })
        .await;
    handler
        .handle(AdminRequest::RouteAdd {
            address: addr("d2", None, None),
            neighbor: "n2".into(),
            distance: 2,
        })
        .await;
    handler
        .handle(AdminRequest::RouteAdd {
            address: addr("d3", None, None),
            neighbor: "n1".into(),
            distance: 3,
        })
        .await;

    let resp = handler
        .handle(AdminRequest::RouteListByNeighbor {
            neighbor: "n1".into(),
        })
        .await;
    let routes = resp.data.unwrap()["routes"].as_array().unwrap().clone();
    assert_eq!(routes.len(), 2);
}

#[tokio::test]
async fn route_list_manual() {
    let handler = make_handler();
    let route_table = handler.route_table.clone();

    // Add a learned route
    {
        let mut table = route_table.write().await;
        table.upsert(addr("d1", None, None), "n1", 0);
    }

    // Add a manual route
    handler
        .handle(AdminRequest::RouteAdd {
            address: addr("d2", None, None),
            neighbor: "n2".into(),
            distance: 5,
        })
        .await;

    let resp = handler.handle(AdminRequest::RouteListManual).await;
    let routes = resp.data.unwrap()["routes"].as_array().unwrap().clone();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["neighbor"], "n2");
}

// ── Rule management ─────────────────────────────────────────────────

#[tokio::test]
async fn rule_list_empty() {
    let handler = make_handler();
    let resp = handler.handle(AdminRequest::RuleList).await;
    assert!(resp.ok);
    assert_eq!(
        resp.data.unwrap()["rules"].as_array().unwrap().len(),
        0
    );
}

#[tokio::test]
async fn rule_add_and_list() {
    let handler = make_handler();

    let resp = handler
        .handle(AdminRequest::RuleAdd {
            rule_def: AdminRuleDef {
                id: "block-evil".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: Some("upload".into()),
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "drop:evil upload".into(),
            },
        })
        .await;
    assert!(resp.ok);

    let resp = handler.handle(AdminRequest::RuleList).await;
    let rules = resp.data.unwrap()["rules"].as_array().unwrap().clone();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0]["id"], "block-evil");
    assert!(rules[0]["enabled"].as_bool().unwrap());
}

#[tokio::test]
async fn rule_remove() {
    let handler = make_handler();

    handler
        .handle(AdminRequest::RuleAdd {
            rule_def: AdminRuleDef {
                id: "r1".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "continue".into(),
            },
        })
        .await;

    let resp = handler.handle(AdminRequest::RuleRemove { id: "r1".into() }).await;
    assert!(resp.ok);
    assert!(resp.data.as_ref().unwrap()["removed"].as_bool().unwrap());

    let resp = handler.handle(AdminRequest::RuleList).await;
    assert_eq!(resp.data.unwrap()["rules"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn rule_enable_disable() {
    let handler = make_handler();

    handler
        .handle(AdminRequest::RuleAdd {
            rule_def: AdminRuleDef {
                id: "r1".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "continue".into(),
            },
        })
        .await;

    // Disable
    let resp = handler.handle(AdminRequest::RuleDisable { id: "r1".into() }).await;
    assert!(resp.ok);
    assert!(resp.data.as_ref().unwrap()["changed"].as_bool().unwrap());

    // Verify disabled
    let resp = handler.handle(AdminRequest::RuleList).await;
    let rules = resp.data.unwrap()["rules"].as_array().unwrap().clone();
    assert!(!rules[0]["enabled"].as_bool().unwrap());

    // Enable
    let resp = handler.handle(AdminRequest::RuleEnable { id: "r1".into() }).await;
    assert!(resp.ok);
    assert!(resp.data.as_ref().unwrap()["changed"].as_bool().unwrap());
}

#[tokio::test]
async fn rule_add_invalid_action() {
    let handler = make_handler();

    let resp = handler
        .handle(AdminRequest::RuleAdd {
            rule_def: AdminRuleDef {
                id: "r1".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "invalid_action".into(),
            },
        })
        .await;
    assert!(!resp.ok);
    assert!(resp.error.unwrap().contains("unknown action format"));
}

// ── Query ───────────────────────────────────────────────────────────

#[tokio::test]
async fn revision_query() {
    let handler = make_handler();

    // Initial revision
    let resp = handler.handle(AdminRequest::Revision).await;
    assert!(resp.ok);
    assert_eq!(resp.data.as_ref().unwrap()["route_revision"], 0);
    assert_eq!(resp.data.as_ref().unwrap()["rule_revision"], 0);

    // Mutate route table
    handler
        .handle(AdminRequest::RouteAdd {
            address: addr("d1", None, None),
            neighbor: "n1".into(),
            distance: 1,
        })
        .await;

    // Mutate rule table
    handler
        .handle(AdminRequest::RuleAdd {
            rule_def: AdminRuleDef {
                id: "r1".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "continue".into(),
            },
        })
        .await;

    let resp = handler.handle(AdminRequest::Revision).await;
    assert_eq!(resp.data.as_ref().unwrap()["route_revision"], 1);
    assert_eq!(resp.data.as_ref().unwrap()["rule_revision"], 1);
}

#[tokio::test]
async fn dry_run_not_implemented() {
    let handler = make_handler();
    let envelope = osgp::SessionEnvelope::new(
        addr("src", None, None),
        addr("tgt", None, None),
        "test",
        json!({}),
    );
    let resp = handler
        .handle(AdminRequest::DryRun {
            envelope,
            from_neighbor: None,
        })
        .await;
    assert!(!resp.ok);
    assert!(resp.error.unwrap().contains("not yet implemented"));
}

// ── Serialization round-trip ────────────────────────────────────────

#[test]
fn admin_request_serde_round_trip() {
    let req = AdminRequest::RouteAdd {
        address: addr("d1", Some("rt1"), Some("s1")),
        neighbor: "n1".into(),
        distance: 5,
    };
    let json = serde_json::to_string(&req).unwrap();
    let decoded: AdminRequest = serde_json::from_str(&json).unwrap();
    match decoded {
        AdminRequest::RouteAdd {
            address,
            neighbor,
            distance,
        } => {
            assert_eq!(address.domain, "d1");
            assert_eq!(neighbor, "n1");
            assert_eq!(distance, 5);
        }
        other => panic!("expected RouteAdd, got: {:?}", other),
    }
}

#[test]
fn admin_response_serde_round_trip() {
    let resp = AdminResponse::ok(json!({"test": true}));
    let json = serde_json::to_string(&resp).unwrap();
    let decoded: AdminResponse = serde_json::from_str(&json).unwrap();
    assert!(decoded.ok);
    assert_eq!(decoded.data.unwrap()["test"], true);

    let resp = AdminResponse::error("something broke");
    let json = serde_json::to_string(&resp).unwrap();
    let decoded: AdminResponse = serde_json::from_str(&json).unwrap();
    assert!(!decoded.ok);
    assert_eq!(decoded.error.unwrap(), "something broke");
}
