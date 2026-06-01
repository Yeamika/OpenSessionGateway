//! Basic forwarding and fan-out tests.

use super::*;

#[tokio::test]
async fn forward_envelope_to_known_peer() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);

    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // Use canonical control subtype (goes through route table, not fan-out)
    let env = make_envelope("dom-a", "dom-b", "control.add_prompt");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let msg = rx.try_recv().expect("client-b should receive");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
            assert_eq!(e.ttl, 31);
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn forward_non_canonical_subtype_rejected() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);

    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // Non-canonical subtype should be rejected
    let env = make_envelope("dom-a", "dom-b", "im_gateway.message");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Should NOT receive the message (rejected by subtype validation)
    assert!(
        rx.try_recv().is_err(),
        "non-canonical subtype should be rejected"
    );
}

#[tokio::test]
async fn forward_drops_on_no_route_emits_tap() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    // Use canonical control subtype (goes through route table, not fan-out)
    let env = make_envelope("dom-a", "dom-unknown", "control.add_prompt");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let event = tap_rx.try_recv().expect("should receive tap event");
    assert!(matches!(event, TapEvent::DropNoRoute { .. }));
}

#[tokio::test]
async fn forward_drops_on_ttl_exhausted() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    // Use canonical control subtype (goes through route table, not fan-out)
    let mut env = make_envelope("dom-a", "dom-b", "control.add_prompt");
    env.ttl = 0;
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let event = tap_rx.try_recv().expect("should receive tap event");
    assert!(matches!(event, TapEvent::DropTtl { .. }));
}

#[tokio::test]
async fn error_reply_sent_on_no_route() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-a", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-a".into(), handle);

    node.learn_route(SessionAddress::new("dom-a", None, None), "client-a", 0)
        .await;

    // Use canonical control subtype (goes through route table, not fan-out)
    let env = make_envelope("dom-a", "dom-unknown", "control.add_prompt");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let msg = rx.try_recv().expect("client-a should receive error reply");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "error.no_route");
            assert_eq!(e.target.domain, "dom-a");
        }
        other => panic!("expected error Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn control_forward_emits_tap() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    let typed_env = osgp::Envelope::new(
        osgp::RouteTarget::node("surface-1"),
        osgp::RouteTarget::node("client-b"),
        osgp::Payload::SessionUpdate(osgp::SessionUpdate {
            session_id: "s1".into(),
            state: osgp::SessionState::Running,
            title: None,
            summary: None,
            metadata: None,
        }),
    );

    node.handle_message(
        "surface-1",
        osgp::LinkMessage::TypedEnvelope(typed_env),
    )
    .await
    .unwrap();

    let event = tap_rx.try_recv().unwrap();
    assert!(matches!(event, TapEvent::ControlForward { .. }));
}

#[tokio::test]
async fn session_update_upload_fans_out_to_surface_viewers() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    // Register an surface_viewer endpoint
    let (observer_handle, mut observer_rx) = make_peer("observer-1", PeerRole::Endpoint);
    let observer_handle = observer_handle.with_capabilities(vec!["surface_viewer".into()]);
    node.connections
        .peers
        .write()
        .await
        .insert("observer-1".into(), observer_handle);

    // Register a Client peer (should NOT receive broadcast)
    let (client_handle, mut client_rx) = make_peer("client-1", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-1".into(), client_handle);

    // Send a session_update typed envelope
    let typed_env = osgp::Envelope::new(
        osgp::RouteTarget::node("source"),
        osgp::RouteTarget::node("target"),
        osgp::Payload::SessionUpdate(osgp::SessionUpdate {
            session_id: "s1".into(),
            state: osgp::SessionState::Running,
            title: Some("Test Session".into()),
            summary: None,
            metadata: None,
        }),
    );

    node.handle_message(
        "source",
        osgp::LinkMessage::TypedEnvelope(typed_env),
    )
    .await
    .unwrap();

    // surface_viewer should receive the session_update upload
    let observer_msg = observer_rx
        .try_recv()
        .expect("surface_viewer should receive session_update");
    match observer_msg {
        osgp::LinkMessage::TypedEnvelope(e) => {
            assert_eq!(e.link_type, osgp::LinkType::Upload);
            assert_eq!(e.subtype, "session_update");
        }
        other => panic!("expected TypedEnvelope, got: {:?}", other),
    }

    // Client should NOT receive the broadcast
    assert!(
        client_rx.try_recv().is_err(),
        "client should not receive session_update broadcast"
    );

    // Should also emit tap event
    let event = tap_rx.try_recv().unwrap();
    assert!(matches!(event, TapEvent::ControlForward { .. }));
}

#[tokio::test]
async fn session_update_legacy_upload_fans_out_to_surface_viewers() {
    let node = RouterNode::new(make_config("router-1"));

    // Register an surface_viewer endpoint
    let (observer_handle, mut observer_rx) = make_peer("observer-1", PeerRole::Endpoint);
    let observer_handle = observer_handle.with_capabilities(vec!["surface_viewer".into()]);
    node.connections
        .peers
        .write()
        .await
        .insert("observer-1".into(), observer_handle);

    // Send a session_update legacy envelope
    let env = make_envelope("dom-a", "dom-b", "session_update");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // surface_viewer should receive the session_update upload
    let observer_msg = observer_rx
        .try_recv()
        .expect("surface_viewer should receive session_update");
    match observer_msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "session_update");
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn requestion_asked_upload_fans_out_to_surface_viewers() {
    let node = RouterNode::new(make_config("router-1"));

    // Register an surface_viewer endpoint
    let (observer_handle, mut observer_rx) = make_peer("observer-1", PeerRole::Endpoint);
    let observer_handle = observer_handle.with_capabilities(vec!["surface_viewer".into()]);
    node.connections
        .peers
        .write()
        .await
        .insert("observer-1".into(), observer_handle);

    // Register a Client peer (should NOT receive broadcast)
    let (client_handle, mut client_rx) = make_peer("client-1", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-1".into(), client_handle);

    // Send a requestion.asked legacy envelope
    let env = make_envelope("dom-a", "dom-b", "requestion.asked");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // surface_viewer should receive the requestion.asked upload
    let observer_msg = observer_rx
        .try_recv()
        .expect("surface_viewer should receive requestion.asked");
    match observer_msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "requestion.asked");
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }

    // Client should NOT receive the broadcast
    assert!(
        client_rx.try_recv().is_err(),
        "client should not receive requestion.asked broadcast"
    );
}

#[tokio::test]
async fn requestion_resolved_upload_fans_out_to_surface_viewers() {
    let node = RouterNode::new(make_config("router-1"));

    // Register an surface_viewer endpoint
    let (observer_handle, mut observer_rx) = make_peer("observer-1", PeerRole::Endpoint);
    let observer_handle = observer_handle.with_capabilities(vec!["surface_viewer".into()]);
    node.connections
        .peers
        .write()
        .await
        .insert("observer-1".into(), observer_handle);

    // Send a requestion.resolved legacy envelope
    let env = make_envelope("dom-a", "dom-b", "requestion.resolved");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // surface_viewer should receive the requestion.resolved upload
    let observer_msg = observer_rx
        .try_recv()
        .expect("surface_viewer should receive requestion.resolved");
    match observer_msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "requestion.resolved");
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

// ── Mailbox reminder scenario ────────────────────────────────────────
//
// Mailbox endpoint outbound reminders use control/add_prompt.
// No new subtypes like mailbox.reminder, MailboxReminders, need_replay are allowed.

#[tokio::test]
async fn mailbox_reminder_control_add_prompt_forwarded() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);

    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // Mailbox reminder uses control.add_prompt
    let env = make_envelope("dom-a", "dom-b", "control.add_prompt");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let msg = rx.try_recv().expect("client-b should receive mailbox reminder");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn mailbox_dynamic_subtype_rejected() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);

    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // Dynamic mailbox subtypes must be rejected
    let env = make_envelope("dom-a", "dom-b", "mailbox.reminder");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Should NOT receive the message
    assert!(
        rx.try_recv().is_err(),
        "mailbox.reminder subtype should be rejected"
    );
}

#[tokio::test]
async fn mailbox_need_replay_subtype_rejected() {
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);

    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // need_replay is not a canonical subtype
    let env = make_envelope("dom-a", "dom-b", "control.need_replay");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Should NOT receive the message
    assert!(
        rx.try_recv().is_err(),
        "need_replay subtype should be rejected"
    );
}

// ── Acceptance criteria tests ────────────────────────────────────────

#[tokio::test]
async fn all_canonical_upload_subtypes_forwarded() {
    let canonical_upload = vec![
        "session_update",
        "requestion.asked",
        "requestion.updated",
        "requestion.resolved",
        "requestion.cancelled",
    ];

    for kind in canonical_upload {
        let node = RouterNode::new(make_config("router-1"));

        // Register a surface_viewer endpoint (upload fan-out target)
        let (handle, mut rx) = make_peer("viewer-1", PeerRole::Endpoint);
        let handle = handle.with_capabilities(vec!["surface_viewer".into()]);
        node.connections
            .peers
            .write()
            .await
            .insert("viewer-1".into(), handle);

        let env = make_envelope("dom-a", "dom-b", kind);
        node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
            .await
            .unwrap();

        assert!(
            rx.try_recv().is_ok(),
            "canonical upload subtype '{kind}' should be fanned out to surface_viewer"
        );
    }
}

#[tokio::test]
async fn all_canonical_control_subtypes_forwarded() {
    let canonical_control = vec![
        "control.add_prompt",
        "control.abort_session",
        "control.compact_session",
        "control.create_session",
        "control.rename_session",
        "control.resume_session",
        "control.requestion_respond",
    ];

    for kind in canonical_control {
        let node = RouterNode::new(make_config("router-1"));
        let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
        node.connections
            .peers
            .write()
            .await
            .insert("client-b".into(), handle);
        node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
            .await;

        let env = make_envelope("dom-a", "dom-b", kind);
        node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
            .await
            .unwrap();

        assert!(
            rx.try_recv().is_ok(),
            "canonical control subtype '{kind}' should be forwarded"
        );
    }
}

#[tokio::test]
async fn unknown_pairs_dropped_with_warning() {
    let unknown_pairs = vec![
        "im_gateway.message",
        "timer.fired",
        "mailbox.reminder",
        "MailboxReminders",
        "custom_event",
        "unknown.type",
    ];

    for kind in unknown_pairs {
        let node = RouterNode::new(make_config("router-1"));
        let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
        node.connections
            .peers
            .write()
            .await
            .insert("client-b".into(), handle);
        node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
            .await;

        let env = make_envelope("dom-a", "dom-b", kind);
        node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
            .await
            .unwrap();

        assert!(
            rx.try_recv().is_err(),
            "unknown pair '{kind}' should be dropped"
        );
    }
}

#[tokio::test]
async fn response_mirror_accepted() {
    // response/add_prompt should be accepted as mirror of control/add_prompt
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);
    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    // Create a response envelope with add_prompt subtype
    let env = osgp::SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: SessionAddress::domain_only("dom-a"),
        target: SessionAddress::domain_only("dom-b"),
        kind: "response".to_string(),
        link_type: "response".to_string(),
        subtype: "add_prompt".to_string(),
        payload: serde_json::json!({}),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    assert!(
        rx.try_recv().is_ok(),
        "response/add_prompt mirror should be accepted"
    );
}

#[tokio::test]
async fn response_unknown_dropped() {
    // response with unknown subtype should be dropped
    let node = RouterNode::new(make_config("router-1"));
    let (handle, mut rx) = make_peer("client-b", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-b".into(), handle);
    node.learn_route(SessionAddress::new("dom-b", None, None), "client-b", 0)
        .await;

    let env = osgp::SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: SessionAddress::domain_only("dom-a"),
        target: SessionAddress::domain_only("dom-b"),
        kind: "response".to_string(),
        link_type: "response".to_string(),
        subtype: "unknown_response".to_string(),
        payload: serde_json::json!({}),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    assert!(
        rx.try_recv().is_err(),
        "response with unknown subtype should be dropped"
    );
}

#[tokio::test]
async fn admin_request_internal_exception_works() {
    // admin.request should bypass subtype validation and be handled internally
    let node = RouterNode::new(make_config("router-1"));
    let (sender_handle, mut sender_rx) = make_peer("client-a", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("client-a".into(), sender_handle);

    // Grant admin permission
    grant(&node, "client-a", gv_core::PermissionOp::AdminRoutesRead).await;

    // Set up a route for dom-a so the admin response can be sent back
    node.learn_route(SessionAddress::new("dom-a", None, None), "client-a", 0)
        .await;

    let env = osgp::SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: SessionAddress::domain_only("dom-a"),
        target: SessionAddress::domain_only("dom-b"),
        kind: "admin.request".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_request".to_string(),
        payload: serde_json::json!({"type": "route_list"}),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // admin.request is handled internally: sender should receive admin.response
    let msg = sender_rx
        .try_recv()
        .expect("client-a should receive admin.response");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "admin.response");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "admin_response");
        }
        other => panic!("expected admin.response Envelope, got: {:?}", other),
    }
}
