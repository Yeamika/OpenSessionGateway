//! Upstream fallback and reflection-prevention tests.

use super::*;

// ── Upstream fallback tests ─────────────────────────────────────────

#[tokio::test]
async fn legacy_envelope_upstream_fallback_on_no_local_route() {
    // Router-1 is a child of upstream-router with no local route for dom-unknown.
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    // Register client-a so the error reply path exists
    let (client_handle, mut _client_rx) = make_peer("dom-a", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("dom-a".into(), client_handle);
    node.learn_route(SessionAddress::new("dom-a", None, None), "dom-a", 0)
        .await;

    // Send a control envelope for an unknown target — should forward to upstream
    // Using canonical subtype control.add_prompt
    let env = make_envelope("dom-a", "dom-unknown", "control.add_prompt");
    node.handle_message("dom-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Upstream should receive the envelope
    let msg = upstream_rx
        .try_recv()
        .expect("upstream should receive the envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.add_prompt");
            assert_eq!(e.link_type, "control");
            assert_eq!(e.subtype, "add_prompt");
            assert_eq!(e.target.domain, "dom-unknown");
        }
        other => panic!("expected Envelope at upstream, got: {:?}", other),
    }
}

#[tokio::test]
async fn legacy_envelope_no_upstream_drops_normally() {
    // Router-1 has no upstream — envelope with no route should be dropped normally.
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    // Register client-a for error reply delivery
    let (client_handle, mut client_rx) = make_peer("dom-a", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("dom-a".into(), client_handle);
    node.learn_route(SessionAddress::new("dom-a", None, None), "dom-a", 0)
        .await;

    let env = make_envelope("dom-a", "dom-unknown", "control.add_prompt");
    node.handle_message("dom-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Should emit DropNoRoute tap (no upstream to fall back to)
    let event = tap_rx.try_recv().expect("should receive tap event");
    assert!(matches!(event, TapEvent::DropNoRoute { .. }));

    // Should also emit ErrorReply tap
    let event2 = tap_rx.try_recv().expect("should receive error reply tap");
    assert!(matches!(event2, TapEvent::ErrorReply { .. }));

    // client-a should receive the error reply
    let msg = client_rx.try_recv().expect("client-a should receive error reply");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "error.no_route");
        }
        other => panic!("expected error Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn legacy_envelope_not_reflected_back_to_upstream() {
    // If the message came from upstream, don't bounce it back.
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    let env = make_envelope("dom-a", "dom-unknown", "control.add_prompt");
    // from_neighbor == upstream node_id → should NOT forward back to upstream
    node.handle_message("upstream-router", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Upstream should NOT receive the envelope (would cause a loop)
    assert!(
        upstream_rx.try_recv().is_err(),
        "envelope should not be reflected back to upstream"
    );
}

#[tokio::test]
async fn typed_envelope_upstream_fallback_on_no_local_route() {
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    // Create a Control typed envelope targeting unknown node
    let typed_env = osgp::Envelope::new(
        osgp::RouteTarget::node("source-node"),
        osgp::RouteTarget::node("unknown-target"),
        osgp::Payload::SessionCommand(osgp::SessionCommand {
            command: "abort_session".into(),
            subtype: osgp::SessionCommandKind::AbortSession {
                session_id: osgp::SessionId::new("s1"),
            },
            payload: json!({}),
        }),
    );

    node.handle_message("source-node", osgp::LinkMessage::TypedEnvelope(typed_env))
        .await
        .unwrap();

    // Upstream should receive the typed envelope
    let msg = upstream_rx
        .try_recv()
        .expect("upstream should receive typed envelope");
    match msg {
        osgp::LinkMessage::TypedEnvelope(e) => {
            assert_eq!(e.link_type, osgp::LinkType::Control);
            assert_eq!(e.subtype, "abort_session");
        }
        other => panic!("expected TypedEnvelope at upstream, got: {:?}", other),
    }
}

#[tokio::test]
async fn read_request_upstream_fallback_on_no_local_route() {
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    let request = ReadRequest::new(
        SessionAddress::new("requester", None, None),
        SessionAddress::new("unknown-target", None, None),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt-1".into(),
            workspace: None,
        },
    );

    grant_standard(&node, "requester").await;
    node.handle_message("requester", osgp::LinkMessage::ReadRequest(request))
        .await
        .unwrap();

    // Upstream should receive the read request
    let msg = upstream_rx
        .try_recv()
        .expect("upstream should receive read request");
    match msg {
        osgp::LinkMessage::ReadRequest(req) => {
            assert_eq!(req.target.domain, "unknown-target");
        }
        other => panic!("expected ReadRequest at upstream, got: {:?}", other),
    }
}

#[tokio::test]
async fn read_request_no_upstream_sends_error_response() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    // Register requester as a peer so error response can be delivered
    let (req_handle, mut req_rx) = make_peer("requester", PeerRole::Endpoint);
    node.connections
        .peers
        .write()
        .await
        .insert("requester".into(), req_handle);
    node.learn_route(SessionAddress::new("requester", None, None), "requester", 0)
        .await;

    let request = ReadRequest::new(
        SessionAddress::new("requester", None, None),
        SessionAddress::new("unknown-target", None, None),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt-1".into(),
            workspace: None,
        },
    );

    grant_standard(&node, "requester").await;
    node.handle_message("requester", osgp::LinkMessage::ReadRequest(request))
        .await
        .unwrap();

    // First tap: ReadRequestForward (always emitted before routing match)
    let event1 = tap_rx.try_recv().expect("should receive tap");
    assert!(matches!(event1, TapEvent::ReadRequestForward { .. }));

    // Second tap: ReadRequestDrop (no route, no upstream)
    let event2 = tap_rx.try_recv().expect("should receive tap");
    assert!(matches!(event2, TapEvent::ReadRequestDrop { .. }));

    // Third tap: ReadResponseForward (error response being routed back)
    let event3 = tap_rx.try_recv().expect("should receive tap");
    assert!(matches!(event3, TapEvent::ReadResponseForward { .. }));

    // Requester should receive error response
    let msg = req_rx
        .try_recv()
        .expect("requester should receive error response");
    match msg {
        osgp::LinkMessage::ReadResponse(resp) => {
            assert!(!resp.is_ok());
        }
        other => panic!("expected ReadResponse, got: {:?}", other),
    }
}

#[tokio::test]
async fn read_request_not_reflected_back_to_upstream() {
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    let request = ReadRequest::new(
        SessionAddress::new("requester", None, None),
        SessionAddress::new("unknown-target", None, None),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt-1".into(),
            workspace: None,
        },
    );

    // from_neighbor == upstream node_id → ReadRequest should NOT bounce back.
    // However, an error ReadResponse will be routed via upstream (correct behavior:
    // upstream knows how to reach the requester).
    grant_standard(&node, "upstream-router").await;
    node.handle_message("upstream-router", osgp::LinkMessage::ReadRequest(request))
        .await
        .unwrap();

    // The upstream should receive a ReadResponse (error), NOT a ReadRequest
    let msg = upstream_rx
        .try_recv()
        .expect("upstream should receive error response for the requester");
    match msg {
        osgp::LinkMessage::ReadResponse(resp) => {
            assert!(!resp.is_ok(), "response should be an error");
            // The response targets the original requester, which is behind upstream
            assert_eq!(resp.target.domain, "requester");
        }
        osgp::LinkMessage::ReadRequest(_) => {
            panic!("ReadRequest should not be reflected back to upstream");
        }
        other => panic!("expected ReadResponse at upstream, got: {:?}", other),
    }
}

#[tokio::test]
async fn typed_envelope_not_reflected_back_to_upstream() {
    // If a typed envelope came from upstream, don't bounce it back.
    let node = RouterNode::new(make_config("router-1"));
    let (upstream_handle, mut upstream_rx) = make_upstream("upstream-router");
    *node.connections.upstream.write().await = Some(upstream_handle);

    let typed_env = osgp::Envelope::new(
        osgp::RouteTarget::node("source-node"),
        osgp::RouteTarget::node("unknown-target"),
        osgp::Payload::SessionCommand(osgp::SessionCommand {
            command: "abort_session".into(),
            subtype: osgp::SessionCommandKind::AbortSession {
                session_id: osgp::SessionId::new("s1"),
            },
            payload: json!({}),
        }),
    );

    // from_neighbor == upstream node_id
    node.handle_message("upstream-router", osgp::LinkMessage::TypedEnvelope(typed_env))
        .await
        .unwrap();

    // Upstream should NOT receive the envelope back
    assert!(
        upstream_rx.try_recv().is_err(),
        "typed envelope should not be reflected back to upstream"
    );
}
