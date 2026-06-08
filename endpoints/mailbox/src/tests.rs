use crate::{
    config::ConfigStore,
    mcp,
    state::SharedState,
    tools::{self, MailboxToolServices},
};
use gv_core::{ApprovalKind, GrantRecord, PermissionOp};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

async fn call(tools: &MailboxToolServices, name: &str, args: Value) -> Value {
    tools
        .call(name, args)
        .await
        .expect("tool ok")
        .expect("known tool")
}

#[tokio::test]
async fn mailbox_crud_reply_delete_and_sort_desc() {
    let tools = MailboxToolServices::new();
    let first = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a",
            "runtimeID": "rt-target", "sessionID": "target-a",
            "title": "first", "msg": "alpha", "type": "Notice"
        }),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let second = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a",
            "runtimeID": "rt-target", "sessionID": "target-a",
            "title": "second", "msg": "beta", "type": "NeedReplay"
        }),
    )
    .await;

    let list = call(
        &tools,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "size": 10
        }),
    )
    .await;
    let items = list["list"].as_array().expect("items");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["title"], "second");
    assert_eq!(items[1]["ItemID"], first["itemID"]);
    assert_eq!(items[0]["InfoType"], "NeedReplay");

    let read = call(&tools, "ReadMailboxItem", json!({
        "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "itemID": second["itemID"]
    })).await;
    assert_eq!(read["content"], "beta");
    assert_eq!(read["hasRead"], true);

    let reminders = call(
        &tools,
        "MailboxReminders",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a"
        }),
    )
    .await;
    assert_eq!(reminders["count"], 0);

    let reply = call(
        &tools,
        "ReplyMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a",
            "replayID": second["replayID"], "msg": "answer"
        }),
    )
    .await;
    assert_eq!(reply["ok"], true);

    let caller_list = call(
        &tools,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a", "size": 10
        }),
    )
    .await;
    assert_eq!(
        caller_list["list"][0]["InfoType"]
            .as_str()
            .unwrap()
            .starts_with("QuestReply("),
        true
    );

    let delete = call(&tools, "DeleteMailboxItem", json!({
        "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "itemID": first["itemID"]
    })).await;
    assert_eq!(delete["ok"], true);
}

#[tokio::test]
async fn caller_bucket_is_not_target_identity() {
    let tools = MailboxToolServices::new();
    call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorSessionID": "sender", "runtimeID": "rt-x", "sessionID": "recipient",
            "title": "boundary", "msg": "payload"
        }),
    )
    .await;
    let sender_list = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "sender" }),
    )
    .await;
    let recipient_list = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "recipient" }),
    )
    .await;
    assert_eq!(sender_list["realsize"], 0);
    assert_eq!(recipient_list["realsize"], 1);
}

#[tokio::test]
async fn mcp_lists_and_calls_mailbox_tools() {
    let state = SharedState::new();
    let tools = MailboxToolServices::new();
    let config = ConfigStore::new(None, None);
    config.load_initial(&state).await.expect("config");
    let init = mcp::handle(
        &state,
        &tools,
        &config,
        br#"{"jsonrpc":"2.0","id":0,"method":"initialize"}"#,
    )
    .await;
    assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(init["result"]["serverInfo"]["name"], "mailbox-endpoint");
    let list = mcp::handle(
        &state,
        &tools,
        &config,
        br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
    )
    .await;
    assert!(list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tool| tool["name"] == "ListMailboxItems"));
    let send = mcp::handle(&state, &tools, &config, br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"SendMailboxItem","arguments":{"ExecutorSessionID":"sender","runtimeID":"rt","sessionID":"target","title":"mcp","msg":"body"}}}"#).await;
    let text = send["result"]["content"][0]["text"].as_str().unwrap();
    let body: Value = serde_json::from_str(text).unwrap();
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn config_reload_updates_defaults_without_losing_mailbox() {
    let path = temp_path("mailbox-config-reload.json");
    fs::write(
        &path,
        r#"{"listen":"127.0.0.1:7312","executor":{"runtime_id":"rt-a","session_id":"ses-a"}}"#,
    )
    .unwrap();
    let state = SharedState::new();
    let config = ConfigStore::new(Some(path.clone()), None);
    let initial = config.load_initial(&state).await.unwrap();
    assert_eq!(initial.executor_session_id.as_deref(), Some("ses-a"));

    let tools = MailboxToolServices::new();
    call(&tools, "SendMailboxItem", json!({
        "ExecutorSessionID": "sender", "runtimeID": "rt", "sessionID": "target", "title": "kept", "msg": "body"
    })).await;
    fs::write(
        &path,
        r#"{"listen":"127.0.0.1:7313","executor":{"runtime_id":"rt-b","session_id":"ses-b"}}"#,
    )
    .unwrap();
    let reloaded = config.reload(&state).await.unwrap();
    assert_eq!(reloaded["config"]["executor_session_id"], "ses-b");
    let target = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "target" }),
    )
    .await;
    assert_eq!(target["realsize"], 1);
    let _ = fs::remove_file(path);
}

fn temp_path(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("glassvein-{name}-{}", std::process::id()));
    path
}

// ── Router handshake tests ──────────────────────────────────────────

#[test]
fn link_handshake_peer_id_and_protocol() {
    let hs = osgp::LinkHandshake::new("mailbox-endpoint");
    assert_eq!(hs.peer_id, "mailbox-endpoint");
    assert_eq!(hs.protocol_version, "osgp/1");
    let json = serde_json::to_string(&hs).unwrap();
    assert!(json.contains("peerId"));
    assert!(json.contains("protocolVersion"));
    // No role field (LinkHandshake doesn't carry role)
    assert!(!json.contains("role"));
    // No capabilities field
    assert!(!json.contains("capabilities"));
}

#[test]
fn link_handshake_with_metadata() {
    let hs = osgp::LinkHandshake::new("mailbox-endpoint")
        .with_metadata(json!({"endpoint_type": "mailbox"}));
    assert_eq!(hs.peer_id, "mailbox-endpoint");
    assert!(hs.metadata.is_some());
    let meta = hs.metadata.unwrap();
    assert_eq!(meta["endpoint_type"], "mailbox");
}

#[test]
fn link_handshake_roundtrip() {
    let hs = osgp::LinkHandshake::new("test-peer");
    let json = serde_json::to_string(&hs).unwrap();
    let de: osgp::LinkHandshake = serde_json::from_str(&json).unwrap();
    assert_eq!(de.peer_id, "test-peer");
    assert_eq!(de.protocol_version, "osgp/1");
}

#[test]
fn handshake_kind_parses_link_handshake() {
    let hs = osgp::LinkHandshake::new("router-1");
    let json = serde_json::to_string(&hs).unwrap();
    let kind: osgp::HandshakeKind = serde_json::from_str(&json).unwrap();
    match kind {
        osgp::HandshakeKind::Link(h) => assert_eq!(h.peer_id, "router-1"),
        _ => panic!("expected Link variant"),
    }
}

#[test]
#[allow(deprecated)]
fn handshake_kind_parses_legacy_hello() {
    let hello = json!({
        "nodeId": "old-router",
        "role": "router",
        "addresses": [],
        "capabilities": []
    });
    let kind: osgp::HandshakeKind = serde_json::from_value(hello).unwrap();
    match kind {
        osgp::HandshakeKind::Hello(h) => {
            assert_eq!(h.node_id, "old-router");
        }
        _ => panic!("expected Hello variant"),
    }
}

// ── Permission gate tests ───────────────────────────────────────────

#[test]
fn permission_op_announce_route_wire_name() {
    assert_eq!(PermissionOp::AnnounceRoute.as_str(), "announce.route");
    assert_eq!(
        PermissionOp::from_str("announce.route"),
        Some(PermissionOp::AnnounceRoute)
    );
}

#[test]
fn permission_op_read_runtime_session_messages() {
    assert_eq!(
        PermissionOp::ReadRuntimeSessionMessages.as_str(),
        "read.runtime_session_messages"
    );
    assert_eq!(
        PermissionOp::from_str("read.runtime_session_messages"),
        Some(PermissionOp::ReadRuntimeSessionMessages)
    );
}

#[test]
fn permission_op_admin_routes_read() {
    assert_eq!(PermissionOp::AdminRoutesRead.as_str(), "admin.routes.read");
    assert_eq!(
        PermissionOp::from_str("admin.routes.read"),
        Some(PermissionOp::AdminRoutesRead)
    );
}

#[test]
fn permission_op_from_str_unknown_returns_none() {
    assert_eq!(PermissionOp::from_str("unknown.op"), None);
    assert_eq!(PermissionOp::from_str(""), None);
}

#[test]
fn grant_record_serde_roundtrip() {
    let grant = GrantRecord {
        peer_id: "mailbox-endpoint".to_string(),
        op: PermissionOp::AnnounceRoute,
        kind: ApprovalKind::Persist,
    };
    let json = serde_json::to_string(&grant).unwrap();
    eprintln!("GrantRecord JSON: {}", json);
    assert!(json.contains("mailbox-endpoint"));
    // serde uses snake_case: "announce_route", as_str() uses "announce.route"
    assert!(json.contains("announce_route") || json.contains("announce.route"));
    assert!(json.contains("persist"));

    let de: GrantRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(de.peer_id, "mailbox-endpoint");
    assert_eq!(de.op, PermissionOp::AnnounceRoute);
    assert_eq!(de.kind, ApprovalKind::Persist);
}

// ── Router state-file permission snippet test ───────────────────────

#[test]
fn state_file_with_mailbox_grant_roundtrip() {
    let state = router_state_with_mailbox_grant();
    let json = serde_json::to_string_pretty(&state).unwrap();
    assert!(json.contains("mailbox-endpoint"));
    // serde uses snake_case for enum variants
    assert!(json.contains("announce_route") || json.contains("announce.route"));

    let de: GrantRecord =
        serde_json::from_str(&serde_json::to_string(&state.persistent_grants[0]).unwrap()).unwrap();
    assert_eq!(de.peer_id, "mailbox-endpoint");
    assert_eq!(de.op, PermissionOp::AnnounceRoute);
    assert_eq!(de.kind, ApprovalKind::Persist);
}

fn router_state_with_mailbox_grant() -> gv_core_mock::MockRouterState {
    gv_core_mock::MockRouterState {
        schema_version: 1,
        node_id: "test-router".to_string(),
        persistent_grants: vec![GrantRecord {
            peer_id: "mailbox-endpoint".to_string(),
            op: PermissionOp::AnnounceRoute,
            kind: ApprovalKind::Persist,
        }],
    }
}

/// Minimal mock of RouterState for testing grant serialization
/// without depending on the router crate.
mod gv_core_mock {
    use gv_core::GrantRecord;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct MockRouterState {
        pub schema_version: u32,
        pub node_id: String,
        pub persistent_grants: Vec<GrantRecord>,
    }
}

// ── Reminder envelope tests ────────────────────────────────────────

#[tokio::test]
async fn send_mailbox_item_with_router_sends_deliver_envelope() {
    use osgp::LinkMessage;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();
    let tools = MailboxToolServices::new_with_router(tx, vec![]);

    let result = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "sender-rt", "ExecutorSessionID": "sender-ses",
            "runtimeID": "target-rt", "sessionID": "target-ses",
            "title": "Test Title", "msg": "Test content", "type": "Notice"
        }),
    )
    .await;

    // With router, SendMailboxItem sends deliver envelope (remote delivery)
    assert_eq!(result["ok"], true);
    assert_eq!(result["remote"], true);

    // Should have received exactly one deliver envelope
    let envelope_msg = rx.try_recv().expect("expected deliver envelope");
    match envelope_msg {
        LinkMessage::Envelope(env) => {
            // Canonical subtype assertions
            assert_eq!(env.link_type, "control", "linkType must be 'control'");
            assert_eq!(env.subtype, "add_prompt", "subtype must be 'add_prompt'");
            assert_eq!(env.kind, "control.add_prompt");

            // Target is the mailbox receive address of the target runtime
            assert_eq!(env.target.domain, "domain-a");
            assert_eq!(env.target.runtime.as_deref(), Some("target-rt"));
            assert_eq!(env.target.session.as_deref(), Some("mailbox"));

            // Payload must have kind=deliver
            assert_eq!(env.payload["mailbox"]["kind"].as_str().unwrap(), "deliver");
            assert_eq!(
                env.payload["mailbox"]["recipientRuntimeID"]
                    .as_str()
                    .unwrap(),
                "target-rt"
            );
            assert_eq!(
                env.payload["mailbox"]["recipientSessionID"]
                    .as_str()
                    .unwrap(),
                "target-ses"
            );
            assert_eq!(env.ttl, 32);
        }
        other => panic!("expected Envelope, got {:?}", other),
    }

    // No more envelopes
    assert!(rx.try_recv().is_err(), "should have exactly one envelope");
}

#[tokio::test]
async fn send_mailbox_item_with_router_uses_configured_domain() {
    use osgp::LinkMessage;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();
    let tools = MailboxToolServices::new_with_router_domain(tx, vec![], "opencode");

    let result = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a",
            "runtimeID": "rt-b", "sessionID": "ses-b",
            "title": "domain", "msg": "body", "type": "Notice"
        }),
    )
    .await;

    assert_eq!(result["ok"], true);
    let envelope_msg = rx.try_recv().expect("expected deliver envelope");
    match envelope_msg {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.source.domain, "opencode");
            assert_eq!(env.target.domain, "opencode");
            assert_eq!(env.target.runtime.as_deref(), Some("rt-b"));
            assert_eq!(env.target.session.as_deref(), Some("mailbox"));
        }
        other => panic!("expected Envelope, got {:?}", other),
    }
}

#[tokio::test]
async fn deliver_handler_stores_and_sends_reminder() {
    use osgp::LinkMessage;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();
    let tools = MailboxToolServices::new_with_router(tx, vec![]);

    let args = tools::DeliveryArgs {
        recipient_runtime_id: "recipient-rt".into(),
        recipient_session_id: "recipient-ses".into(),
        sender_runtime_id: "sender-rt".into(),
        sender_session_id: "sender-ses".into(),
        sender_session_title: "Sender Name".into(),
        title: "Delivery Test".into(),
        content: "Hello via deliver".into(),
        info_type: "Notice".into(),
    };

    let item_id = tools.deliver(args, None).await.expect("deliver ok");
    assert!(!item_id.is_empty(), "item_id should be non-empty");

    // Should have received one reminder envelope
    let envelope_msg = rx.try_recv().expect("expected reminder envelope");
    match envelope_msg {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.link_type, "control");
            assert_eq!(env.subtype, "add_prompt");
            // Reminder has kind=reminder
            assert_eq!(env.payload["mailbox"]["kind"].as_str().unwrap(), "reminder");
            assert_eq!(env.payload["sessionID"].as_str().unwrap(), "recipient-ses");
            assert!(env.payload["msg"]
                .as_str()
                .unwrap()
                .contains("[OSG-Mailbox-Reminder]"));
            assert!(env.payload["system"]
                .as_str()
                .unwrap()
                .contains("<mailbox>"));
            assert_eq!(env.payload["mailbox"]["itemID"].as_str().unwrap(), item_id);
            // Target is the recipient session
            assert_eq!(env.target.runtime.as_deref(), Some("recipient-rt"));
            assert_eq!(env.target.session.as_deref(), Some("recipient-ses"));
        }
        other => panic!("expected Envelope, got {:?}", other),
    }
}

#[tokio::test]
async fn send_mailbox_item_without_router_stores_locally() {
    let tools = MailboxToolServices::new();

    let result = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorSessionID": "sender",
            "runtimeID": "target-rt", "sessionID": "target-ses",
            "title": "Local", "msg": "No router"
        }),
    )
    .await;

    // Without router, stores locally
    assert_eq!(result["ok"], true);
    assert!(result["itemID"].as_str().is_some());
    assert!(result.get("remote").is_none(), "should not be remote");
}

#[tokio::test]
async fn deliver_handler_needreplay_also_works() {
    use osgp::LinkMessage;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();
    let tools = MailboxToolServices::new_with_router(tx, vec![]);

    let args = tools::DeliveryArgs {
        recipient_runtime_id: "rt".into(),
        recipient_session_id: "ses".into(),
        sender_runtime_id: "sender".into(),
        sender_session_id: "sender-ses".into(),
        sender_session_title: "Sender".into(),
        title: "Question".into(),
        content: "Please reply".into(),
        info_type: "NeedReplay".into(),
    };

    let item_id = tools.deliver(args, None).await.expect("deliver ok");
    assert!(!item_id.is_empty());

    let envelope_msg = rx.try_recv().expect("expected reminder");
    match envelope_msg {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.link_type, "control");
            assert_eq!(env.subtype, "add_prompt");
            assert_eq!(env.payload["mailbox"]["kind"].as_str().unwrap(), "reminder");
            assert_eq!(
                env.payload["mailbox"]["infoType"].as_str().unwrap(),
                "NeedReplay"
            );
        }
        other => panic!("expected Envelope, got {:?}", other),
    }
}

#[test]
fn deliver_envelope_has_no_non_canonical_subtype() {
    use osgp::LinkMessage;

    let args = json!({
        "ExecutorRuntimeID": "rt", "ExecutorSessionID": "ses",
        "runtimeID": "target", "sessionID": "target-ses",
        "title": "Title", "msg": "Content", "type": "Notice"
    });

    // Test deliver envelope
    let deliver = crate::tools::build_deliver_envelope(&args);
    match deliver {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.link_type, "control");
            assert_eq!(env.subtype, "add_prompt");
            assert_eq!(env.payload["mailbox"]["kind"].as_str().unwrap(), "deliver");
            assert!(
                osgp::subtype_registry::is_canonical(&env.link_type, &env.subtype),
                "deliver envelope must pass canonical validation"
            );
        }
        other => panic!("expected Envelope, got {:?}", other),
    }

    // Test reminder envelope
    let result = json!({"ok": true, "itemID": "test-id", "replayID": null});
    let reminder = crate::tools::build_reminder_envelope(&args, &result);
    match reminder {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.link_type, "control");
            assert_eq!(env.subtype, "add_prompt");
            assert_eq!(env.payload["mailbox"]["kind"].as_str().unwrap(), "reminder");
            assert!(
                osgp::subtype_registry::is_canonical(&env.link_type, &env.subtype),
                "reminder envelope must pass canonical validation"
            );
        }
        other => panic!("expected Envelope, got {:?}", other),
    }
}

#[tokio::test]
async fn inbound_delivery_matching_uses_receive_addresses() {
    // Test that is_delivery_for_us matches configured receive addresses
    use osgp::{SessionAddress, SessionEnvelope};
    use uuid::Uuid;

    let receive_addrs = vec![SessionAddress::new(
        "domain-a",
        Some("mailbox-endpoint".into()),
        Some("mailbox".into()),
    )];

    // Should match
    let env = SessionEnvelope {
        id: Uuid::new_v4(),
        source: SessionAddress::new("domain-a", Some("sender".into()), Some("s1".into())),
        target: SessionAddress::new(
            "domain-a",
            Some("mailbox-endpoint".into()),
            Some("mailbox".into()),
        ),
        kind: "control.add_prompt".into(),
        link_type: "control".into(),
        subtype: "add_prompt".into(),
        payload: json!({"mailbox": {"kind": "deliver"}}),
        ttl: 32,
        route_hops: vec![],
        origin_surface: None,
    };
    assert!(crate::is_delivery_for_us(&env, &receive_addrs));

    // Should NOT match: wrong target
    let env2 = SessionEnvelope {
        target: SessionAddress::new("domain-a", Some("other".into()), Some("mailbox".into())),
        ..env.clone()
    };
    assert!(!crate::is_delivery_for_us(&env2, &receive_addrs));

    // Should NOT match: wrong kind
    let mut env3 = env.clone();
    env3.payload = json!({"mailbox": {"kind": "reminder"}});
    assert!(!crate::is_delivery_for_us(&env3, &receive_addrs));

    // Should NOT match: wrong linkType
    let mut env4 = env.clone();
    env4.link_type = "upload".into();
    assert!(!crate::is_delivery_for_us(&env4, &receive_addrs));
}
