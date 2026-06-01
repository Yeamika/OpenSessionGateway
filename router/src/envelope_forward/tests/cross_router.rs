//! Cross-router end-to-end tests (two-router topologies).

use super::*;

/// Simulates a simple two-router tree:
///
///   root (knows both east and west routes)
///    ├── east-endpoint
///    └── west-endpoint
///
/// Tests that east→root→west routing works for all message types.
#[tokio::test]
async fn cross_router_east_to_west_via_root_legacy_envelope() {
    let root = RouterNode::new(make_config("root"));

    // Register east-endpoint as a downstream peer of root
    let (east_handle, mut east_rx) = make_peer("east-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("east-endpoint".into(), east_handle);
    root.learn_route(SessionAddress::new("east", None, None), "east-endpoint", 0)
        .await;

    // Register west-endpoint as a downstream peer of root
    let (west_handle, mut west_rx) = make_peer("west-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("west-endpoint".into(), west_handle);
    root.learn_route(SessionAddress::new("west", None, None), "west-endpoint", 0)
        .await;

    // East sends a control envelope to west (using canonical subtype)
    let env = make_envelope("east", "west", "control.add_prompt");
    root.handle_message("east-endpoint", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // West should receive the envelope
    let msg = west_rx.try_recv().expect("west should receive envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
            assert_eq!(e.target.domain, "west");
            assert_eq!(e.source.domain, "east");
        }
        other => panic!("expected Envelope at west, got: {:?}", other),
    }

    // East should NOT receive it (not a broadcast)
    assert!(east_rx.try_recv().is_err(), "east should not receive its own message");
}

#[tokio::test]
async fn cross_router_east_to_west_via_root_typed_envelope() {
    let root = RouterNode::new(make_config("root"));

    // Register endpoints
    let (east_handle, _) = make_peer("east-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("east-endpoint".into(), east_handle);
    root.learn_route(SessionAddress::new("east", None, None), "east-endpoint", 0)
        .await;

    let (west_handle, mut west_rx) = make_peer("west-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("west-endpoint".into(), west_handle);
    root.learn_route(SessionAddress::new("west", None, None), "west-endpoint", 0)
        .await;

    // East sends a typed control envelope to west
    let typed_env = osgp::Envelope::new(
        osgp::RouteTarget::node("east"),
        osgp::RouteTarget::node("west"),
        osgp::Payload::SessionCommand(osgp::SessionCommand {
            command: "abort_session".into(),
            subtype: osgp::SessionCommandKind::AbortSession {
                session_id: osgp::SessionId::new("s1"),
            },
            payload: json!({}),
        }),
    );

    root.handle_message("east-endpoint", osgp::LinkMessage::TypedEnvelope(typed_env))
        .await
        .unwrap();

    // West should receive the typed envelope
    let msg = west_rx.try_recv().expect("west should receive typed envelope");
    match msg {
        osgp::LinkMessage::TypedEnvelope(e) => {
            assert_eq!(e.link_type, osgp::LinkType::Control);
            assert_eq!(e.subtype, "abort_session");
        }
        other => panic!("expected TypedEnvelope at west, got: {:?}", other),
    }
}

#[tokio::test]
async fn cross_router_east_to_west_via_root_read_request_response() {
    let root = RouterNode::new(make_config("root"));

    // Register endpoints
    let (east_handle, mut east_rx) = make_peer("east-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("east-endpoint".into(), east_handle);
    root.learn_route(SessionAddress::new("east", None, None), "east-endpoint", 0)
        .await;

    let (west_handle, mut west_rx) = make_peer("west-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("west-endpoint".into(), west_handle);
    root.learn_route(SessionAddress::new("west", None, None), "west-endpoint", 0)
        .await;

    // East sends a read request to west
    let request = ReadRequest::new(
        SessionAddress::new("east", None, None),
        SessionAddress::new("west", None, None),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt-west".into(),
            workspace: None,
        },
    );

    grant_standard(&root, "east-endpoint").await;
    root.handle_message("east-endpoint", osgp::LinkMessage::ReadRequest(request))
        .await
        .unwrap();

    // West should receive the read request
    let msg = west_rx.try_recv().expect("west should receive read request");
    match msg {
        osgp::LinkMessage::ReadRequest(req) => {
            assert_eq!(req.target.domain, "west");
            assert_eq!(req.source.domain, "east");
        }
        other => panic!("expected ReadRequest at west, got: {:?}", other),
    }

    // West sends back a read response
    let response = osgp::ReadResponse::ok_for_request(
        &SessionAddress::new("west", None, None),
        &osgp::ReadRequest::new(
            SessionAddress::new("east", None, None),
            SessionAddress::new("west", None, None),
            ReadOperation::RuntimeWorkspaceViewSnapshot {
                runtime_id: "rt-west".into(),
                workspace: None,
            },
        ),
        serde_json::json!({"workspaces": []}),
    );

    root.handle_message("west-endpoint", osgp::LinkMessage::ReadResponse(response))
        .await
        .unwrap();

    // East should receive the response
    let msg = east_rx.try_recv().expect("east should receive read response");
    match msg {
        osgp::LinkMessage::ReadResponse(resp) => {
            assert!(resp.is_ok());
            assert_eq!(resp.target.domain, "east");
        }
        other => panic!("expected ReadResponse at east, got: {:?}", other),
    }
}

/// Tests that Announce propagation from downstream leaf → child → root works,
/// and root learns the route correctly for later cross-router forwarding.
#[tokio::test]
async fn cross_router_announce_propagation_enables_routing() {
    let root = RouterNode::new(make_config("root"));
    let child = RouterNode::new(make_config("child"));

    // Wire child → root upstream
    let (root_as_upstream_tx, mut root_from_child_rx) = mpsc::unbounded_channel();
    let upstream_handle = UpstreamHandle::new("root", root_as_upstream_tx);
    *child.connections.upstream.write().await = Some(upstream_handle);

    // Wire root → child as downstream router peer
    let (child_as_peer_tx, _) = mpsc::unbounded_channel();
    let child_peer_handle = PeerHandle::new("child-east", PeerRole::Router, child_as_peer_tx);
    root.connections
        .peers
        .write()
        .await
        .insert("child-east".into(), child_peer_handle);

    // East endpoint announces its address to child
    let leaf_address = SessionAddress::new("leaf-domain", Some("rt-1".into()), Some("ses-1".into()));
    grant(&child, "leaf-endpoint", PermissionOp::AnnounceRoute).await;
    child.handle_message(
        "leaf-endpoint",
        osgp::LinkMessage::Announce {
            address: leaf_address.clone(),
            distance: 0,
        },
    )
    .await
    .unwrap();

    // Child should learn the route locally
    {
        let rt = child.route_table.read().await;
        let decision = rt.decide(&SessionEnvelope::new(
            SessionAddress::new("child", None, None),
            leaf_address.clone(),
            "test",
            serde_json::Value::Null,
        ));
        assert!(
            matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "leaf-endpoint"),
            "child should have local route to leaf"
        );
    }

    // Child should re-announce to upstream (root)
    let announce_msg = root_from_child_rx
        .try_recv()
        .expect("child should re-announce leaf route to root");
    assert!(
        matches!(&announce_msg, osgp::LinkMessage::Announce { address, distance } if *address == leaf_address && *distance == 1),
        "expected Announce with distance=1 from child to root"
    );

    // Root receives the re-announcement
    grant(&root, "child-east", PermissionOp::AnnounceRoute).await;
    root.handle_message("child-east", announce_msg)
        .await
        .unwrap();

    // Root should now have a route to leaf-domain via child-east
    {
        let rt = root.route_table.read().await;
        let decision = rt.decide(&SessionEnvelope::new(
            SessionAddress::new("root", None, None),
            leaf_address.clone(),
            "test",
            serde_json::Value::Null,
        ));
        assert!(
            matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "child-east"),
            "root should route leaf-domain via child-east"
        );
    }
}
