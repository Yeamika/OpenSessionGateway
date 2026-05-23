//! Client library tests.

use osgp::{
    Envelope, LinkMessage, Payload, RouteTarget, SessionAddress, SessionCommand, SessionCommandKind,
    SessionId,
};

use super::client::{ClientIdentity, ClientState};
use super::helpers::create_fake_client;
use super::transport::{FakeTransportHub, Transport};

#[test]
fn client_identity_to_route_target() {
    let identity = ClientIdentity {
        node_id: "node-1".into(),
        address: SessionAddress::new("demo", Some("rt-1".into()), Some("ses-1".into())),
    };

    let target = identity.to_route_target();
    match target {
        RouteTarget::Address { address } => {
            assert_eq!(address.domain, "demo");
            assert_eq!(address.runtime, Some("rt-1".into()));
            assert_eq!(address.session, Some("ses-1".into()));
        }
        _ => panic!("expected Address target"),
    }
}

#[test]
fn client_state_transitions() {
    assert_eq!(ClientState::Disconnected, ClientState::Disconnected);
    assert_eq!(ClientState::Connected, ClientState::Connected);
    assert_eq!(ClientState::Registered, ClientState::Registered);
}

#[tokio::test]
async fn fake_transport_hub_create_and_send() {
    let hub = FakeTransportHub::new();

    let _handle1 = hub.create_transport("node-1").await;
    let handle2 = hub.create_transport("node-2").await;

    hub.send_to("node-2", LinkMessage::Ping).await.unwrap();

    let received = handle2.receive_message().await.unwrap();
    assert!(received.is_some());

    match received.unwrap() {
        LinkMessage::Ping => {}
        _ => panic!("expected Ping message"),
    }
}

#[tokio::test]
async fn client_connect_and_register() {
    let hub = FakeTransportHub::new();
    let mut client =
        create_fake_client("test-client", "demo", Some("rt-1"), Some("ses-1"), &hub).await;

    assert_eq!(*client.state(), ClientState::Disconnected);

    client.connect().await.unwrap();
    assert_eq!(*client.state(), ClientState::Connected);

    client.register().await.unwrap();
    assert_eq!(*client.state(), ClientState::Registered);
}

#[tokio::test]
async fn client_send_requires_registration() {
    let hub = FakeTransportHub::new();
    let client =
        create_fake_client("test-client", "demo", Some("rt-1"), Some("ses-1"), &hub).await;

    let target = RouteTarget::session("other-client", "ses-2");
    let payload = Payload::SessionCommand(SessionCommand {
        command: "add_prompt".into(),
        subtype: SessionCommandKind::AddPrompt {
            session_id: SessionId::new("ses-2"),
        },
        payload: serde_json::json!({"text": "hello", "role": "user"}),
    });
    let result = client.send(target, payload).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn client_send_and_receive() {
    let hub = FakeTransportHub::new();

    let mut client_a =
        create_fake_client("client-a", "demo", Some("rt-1"), Some("ses-1"), &hub).await;
    let mut client_b =
        create_fake_client("client-b", "demo", Some("rt-2"), Some("ses-2"), &hub).await;

    client_a.connect().await.unwrap();
    client_a.register().await.unwrap();
    client_b.connect().await.unwrap();
    client_b.register().await.unwrap();

    // Send from A (goes through fake transport hub loopback)
    let target = RouteTarget::session("client-b", "ses-2");
    let payload = Payload::SessionCommand(SessionCommand {
        command: "add_prompt".into(),
        subtype: SessionCommandKind::AddPrompt {
            session_id: SessionId::new("ses-2"),
        },
        payload: serde_json::json!({"text": "hello from A", "role": "user"}),
    });

    let message_id = client_a.send(target, payload).await.unwrap();
    assert!(!message_id.is_empty());

    // Deliver a typed envelope directly to client-b via hub
    // (simulating router routing)
    let delivered = Envelope::new(
        RouteTarget::node("client-a"),
        RouteTarget::session("client-b", "ses-2"),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("ses-2"),
            },
            payload: serde_json::json!({"text": "hello from A", "role": "user"}),
        }),
    );
    let delivered_id = delivered.message_id.clone();
    hub.send_to("client-b", LinkMessage::TypedEnvelope(delivered))
        .await
        .unwrap();

    let msg = tokio::time::timeout(std::time::Duration::from_secs(1), client_b.receive())
        .await
        .expect("client_b.receive() timed out")
        .unwrap()
        .expect("expected delivered envelope");
    assert_eq!(msg.message_id, delivered_id);
}

#[test]
fn session_address_creation() {
    let addr = SessionAddress::new("demo", Some("rt-1".into()), Some("ses-1".into()));
    assert_eq!(addr.domain, "demo");
    assert_eq!(addr.runtime, Some("rt-1".into()));
    assert_eq!(addr.session, Some("ses-1".into()));
}

#[test]
fn envelope_creation() {
    let source = RouteTarget::node("client-a");
    let target = RouteTarget::session("client-b", "ses-1");
    let payload = Payload::SessionCommand(SessionCommand {
        command: "add_prompt".into(),
        subtype: SessionCommandKind::AddPrompt {
            session_id: SessionId::new("ses-1"),
        },
        payload: serde_json::json!({"text": "hello", "role": "user"}),
    });

    let envelope = Envelope::new(source, target, payload);
    assert!(!envelope.message_id.is_empty());
    assert_eq!(envelope.link_type, osgp::LinkType::Control);
    assert_eq!(envelope.subtype, "add_prompt");
}

#[test]
fn link_message_variants() {
    // Test Ping
    let ping = LinkMessage::Ping;
    let json = serde_json::to_string(&ping).unwrap();
    assert!(json.contains("ping"));

    // Test Announce
    let announce = LinkMessage::Announce {
        address: SessionAddress::new("demo", None, None),
        distance: 0,
    };
    let json = serde_json::to_string(&announce).unwrap();
    assert!(json.contains("announce"));

    // Test TypedEnvelope
    let envelope = Envelope::new(
        RouteTarget::node("a"),
        RouteTarget::node("b"),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("s1"),
            },
            payload: serde_json::json!({"text": "test"}),
        }),
    );
    let msg = LinkMessage::TypedEnvelope(envelope);
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("typed_envelope"));
}
