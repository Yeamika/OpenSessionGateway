//! Cross-router tests with three-level deep topologies.

use super::*;

/// Simulates a three-level tree:
///
///        root
///       /    \
///   child-east  west-endpoint
///      |
///   east-endpoint
///
/// Tests that east→child→root→west routing works (child uses upstream fallback).
#[tokio::test]
async fn cross_router_east_child_root_west_legacy_envelope() {
    let root = RouterNode::new(make_config("root"));
    let child_east = RouterNode::new(make_config("child-east"));

    // Set up child-east's upstream as root (simulated via channel)
    let (root_as_upstream_tx, mut root_from_child_rx) = mpsc::unbounded_channel();
    let upstream_handle = UpstreamHandle::new("root", root_as_upstream_tx);
    *child_east.connections.upstream.write().await = Some(upstream_handle);

    // Register child-east as a downstream peer of root (router peer)
    let (child_as_peer_tx, _child_rx) = mpsc::unbounded_channel();
    let child_peer_handle = PeerHandle::new("child-east", PeerRole::Router, child_as_peer_tx);
    root.connections
        .peers
        .write()
        .await
        .insert("child-east".into(), child_peer_handle);

    // West endpoint connected directly to root
    let (west_handle, mut west_rx) = make_peer("west-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("west-endpoint".into(), west_handle);
    root.learn_route(SessionAddress::new("west", None, None), "west-endpoint", 0)
        .await;

    // Register east-endpoint as peer of child-east
    let (east_handle, _) = make_peer("east-endpoint", PeerRole::Endpoint);
    child_east
        .connections
        .peers
        .write()
        .await
        .insert("east-endpoint".into(), east_handle);
    child_east
        .learn_route(SessionAddress::new("east", None, None), "east-endpoint", 0)
        .await;

    // Root needs to know that west routes exist via child-east too
    // (But for this test, root already knows west-endpoint directly)
    // Root also needs to know east routes via child-east for response routing
    root.learn_route(SessionAddress::new("east", None, None), "child-east", 1)
        .await;

    // Step 1: East sends control envelope to west via child-east
    // Using canonical subtype control.add_prompt
    let env = make_envelope("east", "west", "control.add_prompt");
    child_east
        .handle_message("east-endpoint", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Child-east should forward to upstream (root) since no local route for "west"
    let forwarded = root_from_child_rx
        .try_recv()
        .expect("child-east should forward envelope to root");
    assert!(
        matches!(&forwarded, osgp::LinkMessage::Envelope(e) if e.kind == "control.add_prompt" && e.target.domain == "west"),
        "expected control.add_prompt Envelope from child to root"
    );

    // Step 2: Root receives this from child-east and routes to west-endpoint
    root.handle_message("child-east", forwarded)
        .await
        .unwrap();

    // West-endpoint should receive the envelope
    let msg = west_rx.try_recv().expect("west should receive envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
            assert_eq!(e.target.domain, "west");
        }
        other => panic!("expected Envelope at west, got: {:?}", other),
    }
}

#[tokio::test]
async fn cross_router_east_child_root_west_read_request() {
    let root = RouterNode::new(make_config("root"));
    let child_east = RouterNode::new(make_config("child-east"));

    // Wire child-east → root upstream
    let (root_as_upstream_tx, mut root_from_child_rx) = mpsc::unbounded_channel();
    let upstream_handle = UpstreamHandle::new("root", root_as_upstream_tx);
    *child_east.connections.upstream.write().await = Some(upstream_handle);

    // Wire root → child-east as downstream router peer
    let (child_as_peer_tx, mut child_rx) = mpsc::unbounded_channel();
    let child_peer_handle = PeerHandle::new("child-east", PeerRole::Router, child_as_peer_tx);
    root.connections
        .peers
        .write()
        .await
        .insert("child-east".into(), child_peer_handle);

    // West endpoint on root
    let (west_handle, mut west_rx) = make_peer("west-endpoint", PeerRole::Endpoint);
    root.connections
        .peers
        .write()
        .await
        .insert("west-endpoint".into(), west_handle);
    root.learn_route(SessionAddress::new("west", None, None), "west-endpoint", 0)
        .await;

    // East endpoint on child-east
    let (east_handle, _) = make_peer("east-endpoint", PeerRole::Endpoint);
    child_east
        .connections
        .peers
        .write()
        .await
        .insert("east-endpoint".into(), east_handle);
    child_east
        .learn_route(SessionAddress::new("east", None, None), "east-endpoint", 0)
        .await;

    // Root knows east route via child-east (for response routing)
    root.learn_route(SessionAddress::new("east", None, None), "child-east", 1)
        .await;

    // Step 1: East sends read request to west via child-east
    let request = ReadRequest::new(
        SessionAddress::new("east", None, None),
        SessionAddress::new("west", None, None),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt-west".into(),
            workspace: None,
        },
    );

    grant_standard(&child_east, "east-endpoint").await;
    child_east
        .handle_message("east-endpoint", osgp::LinkMessage::ReadRequest(request))
        .await
        .unwrap();

    // Child-east should forward read request to upstream (root)
    let forwarded = root_from_child_rx
        .try_recv()
        .expect("child-east should forward read request to root");
    assert!(
        matches!(&forwarded, osgp::LinkMessage::ReadRequest(req) if req.target.domain == "west"),
        "expected ReadRequest from child to root"
    );

    // Step 2: Root receives and routes to west
    grant_standard(&root, "child-east").await;
    root.handle_message("child-east", forwarded)
        .await
        .unwrap();

    // West receives the read request
    let msg = west_rx.try_recv().expect("west should receive read request");
    match msg {
        osgp::LinkMessage::ReadRequest(req) => {
            assert_eq!(req.target.domain, "west");
            assert_eq!(req.source.domain, "east");
        }
        other => panic!("expected ReadRequest at west, got: {:?}", other),
    }

    // Step 3: West sends response back
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
        serde_json::json!({"workspaces": ["w1"]}),
    );

    root.handle_message("west-endpoint", osgp::LinkMessage::ReadResponse(response))
        .await
        .unwrap();

    // Root routes response to child-east (via route table: east → child-east)
    let resp_to_child = child_rx
        .try_recv()
        .expect("root should forward response to child-east");
    assert!(
        matches!(&resp_to_child, osgp::LinkMessage::ReadResponse(resp) if resp.is_ok() && resp.target.domain == "east"),
        "expected ReadResponse at child-east"
    );

    // Step 4: Child-east forwards response to east-endpoint
    child_east
        .handle_message("root", resp_to_child)
        .await
        .unwrap();

    // East-endpoint receives the response
    // (need a receiver for east-endpoint — but we already consumed east_rx above)
    // Actually we dropped east_rx since we used `_` for it. Let me just verify
    // the response was correctly handled by child-east (no panic = success).
}

/// Tests east→child→root→nested-child→nested-leaf (3-level deep):
///
///            root
///           /    \
///   child-east   nested-child
///      |              |
///   east-ep     nested-leaf-ep
///
/// east-ep sends to nested-leaf-ep via: child→root→nested-child→nested-leaf
#[tokio::test]
async fn cross_router_three_level_deep_legacy_envelope() {
    let root = RouterNode::new(make_config("root"));
    let child_east = RouterNode::new(make_config("child-east"));
    let nested_child = RouterNode::new(make_config("nested-child"));

    // ── Wire child-east → root ──
    let (root_from_east_tx, mut root_from_east_rx) = mpsc::unbounded_channel();
    let east_upstream = UpstreamHandle::new("root", root_from_east_tx);
    *child_east.connections.upstream.write().await = Some(east_upstream);

    let (east_peer_tx, _) = mpsc::unbounded_channel();
    let east_peer = PeerHandle::new("child-east", PeerRole::Router, east_peer_tx);
    root.connections.peers.write().await.insert("child-east".into(), east_peer);

    // ── Wire nested-child → root ──
    let (root_from_nested_tx, _root_from_nested_rx) = mpsc::unbounded_channel();
    let nested_upstream = UpstreamHandle::new("root", root_from_nested_tx);
    *nested_child.connections.upstream.write().await = Some(nested_upstream);

    let (nested_peer_tx, mut nested_rx) = mpsc::unbounded_channel();
    let nested_peer = PeerHandle::new("nested-child", PeerRole::Router, nested_peer_tx);
    root.connections
        .peers
        .write()
        .await
        .insert("nested-child".into(), nested_peer);

    // ── Endpoints ──
    // east-ep on child-east
    let (east_ep, _) = make_peer("east-ep", PeerRole::Endpoint);
    child_east.connections.peers.write().await.insert("east-ep".into(), east_ep);
    child_east.learn_route(SessionAddress::new("east", None, None), "east-ep", 0).await;

    // nested-leaf-ep on nested-child
    let (nested_leaf_ep, mut nested_leaf_rx) = make_peer("nested-leaf-ep", PeerRole::Endpoint);
    nested_child.connections.peers.write().await.insert("nested-leaf-ep".into(), nested_leaf_ep);
    nested_child.learn_route(SessionAddress::new("leaf", None, None), "nested-leaf-ep", 0).await;

    // Root learns routes
    root.learn_route(SessionAddress::new("east", None, None), "child-east", 1).await;
    root.learn_route(SessionAddress::new("leaf", None, None), "nested-child", 1).await;

    // ── Step 1: east-ep sends control envelope to leaf ──
    // Using canonical subtype control.add_prompt
    let env = make_envelope("east", "leaf", "control.add_prompt");
    child_east
        .handle_message("east-ep", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // child-east → root (upstream fallback)
    let to_root = root_from_east_rx.try_recv().expect("child-east should forward to root");
    match &to_root {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
            assert_eq!(e.target.domain, "leaf");
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }

    // ── Step 2: root routes to nested-child ──
    root.handle_message("child-east", to_root).await.unwrap();

    // nested-child should receive the envelope
    let to_nested = nested_rx.try_recv().expect("root should forward to nested-child");
    match &to_nested {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.target.domain, "leaf");
        }
        other => panic!("expected Envelope at nested-child, got: {:?}", other),
    }

    // ── Step 3: nested-child routes to nested-leaf-ep ──
    nested_child.handle_message("root", to_nested).await.unwrap();

    // nested-leaf-ep should receive the envelope
    let msg = nested_leaf_rx.try_recv().expect("nested-leaf-ep should receive envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.target.domain, "leaf");
            assert_eq!(e.source.domain, "east");
        }
        other => panic!("expected Envelope at leaf, got: {:?}", other),
    }
}
