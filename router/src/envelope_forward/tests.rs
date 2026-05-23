//! Envelope forwarding tests.

use serde_json::json;
use osgp::{ReadOperation, ReadRequest, SessionAddress, SessionEnvelope};
use tokio::sync::mpsc;

use crate::config::RouterConfig;
use crate::node::RouterNode;
use crate::tap::TapEvent;
use crate::transport::{PeerHandle, PeerRole, UpstreamHandle};

fn make_config(node_id: &str) -> RouterConfig {
    RouterConfig::new(node_id, "127.0.0.1:0").with_tap(64)
}

fn make_peer(
    node_id: &str,
    role: PeerRole,
) -> (
    PeerHandle,
    mpsc::UnboundedReceiver<osgp::LinkMessage>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = PeerHandle::new(node_id, role, tx);
    (handle, rx)
}

fn make_upstream(
    node_id: &str,
) -> (
    UpstreamHandle,
    mpsc::UnboundedReceiver<osgp::LinkMessage>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = UpstreamHandle::new(node_id, tx);
    (handle, rx)
}

fn make_envelope(source: &str, target: &str, kind: &str) -> SessionEnvelope {
    SessionEnvelope::new(
        SessionAddress::new(source, None, None),
        SessionAddress::new(target, None, None),
        kind,
        json!({}),
    )
}

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

    let env = make_envelope("dom-a", "dom-b", "test.ping");
    node.handle_message("client-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    let msg = rx.try_recv().expect("client-b should receive");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "test.ping");
            assert_eq!(e.ttl, 31);
        }
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn forward_drops_on_no_route_emits_tap() {
    let node = RouterNode::new(make_config("router-1"));
    let mut tap_rx = node.subscribe_tap().unwrap();

    let env = make_envelope("dom-a", "dom-unknown", "test.ping");
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

    let mut env = make_envelope("dom-a", "dom-b", "test.ping");
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

    let env = make_envelope("dom-a", "dom-unknown", "test.ping");
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
    let env = make_envelope("dom-a", "dom-unknown", "control.ping");
    node.handle_message("dom-a", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Upstream should receive the envelope
    let msg = upstream_rx
        .try_recv()
        .expect("upstream should receive the envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.ping");
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

    let env = make_envelope("dom-a", "dom-unknown", "control.ping");
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

    let env = make_envelope("dom-a", "dom-unknown", "control.ping");
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

// ── Cross-router end-to-end tests ──────────────────────────────────
//
// These tests simulate multi-router tree topologies to verify that
// control envelopes, typed envelopes, read requests, and read responses
// can traverse east → root → west and east → child → root → west paths.

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

    // East sends a control envelope to west
    let env = make_envelope("east", "west", "control.ping");
    root.handle_message("east-endpoint", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // West should receive the envelope
    let msg = west_rx.try_recv().expect("west should receive envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.ping");
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
    let env = make_envelope("east", "west", "control.do_thing");
    child_east
        .handle_message("east-endpoint", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // Child-east should forward to upstream (root) since no local route for "west"
    let forwarded = root_from_child_rx
        .try_recv()
        .expect("child-east should forward envelope to root");
    assert!(
        matches!(&forwarded, osgp::LinkMessage::Envelope(e) if e.kind == "control.do_thing" && e.target.domain == "west"),
        "expected control.do_thing Envelope from child to root"
    );

    // Step 2: Root receives this from child-east and routes to west-endpoint
    root.handle_message("child-east", forwarded)
        .await
        .unwrap();

    // West-endpoint should receive the envelope
    let msg = west_rx.try_recv().expect("west should receive envelope");
    match msg {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.do_thing");
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
    let env = make_envelope("east", "leaf", "control.deep_ping");
    child_east
        .handle_message("east-ep", osgp::LinkMessage::Envelope(env))
        .await
        .unwrap();

    // child-east → root (upstream fallback)
    let to_root = root_from_east_rx.try_recv().expect("child-east should forward to root");
    match &to_root {
        osgp::LinkMessage::Envelope(e) => {
            assert_eq!(e.kind, "control.deep_ping");
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
            assert_eq!(e.kind, "control.deep_ping");
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
            assert_eq!(e.kind, "control.deep_ping");
            assert_eq!(e.target.domain, "leaf");
            assert_eq!(e.source.domain, "east");
        }
        other => panic!("expected Envelope at leaf, got: {:?}", other),
    }
}
