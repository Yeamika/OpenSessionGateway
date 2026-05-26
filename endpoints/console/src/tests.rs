use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
use serde_json::json;

use crate::{
    config::{parse_address, Config, Mode},
    control::build_control,
    request::build_request,
    state::{ConsoleState, SessionRow},
    tui::render_to_string,
};

fn cfg() -> Config {
    Config {
        mode: Mode::Once,
        node_id: "console-test".into(),
        router_url: "ws://127.0.0.1:7200".into(),
        address: parse_address("domain-a/console/runtime").unwrap(),
        target: parse_address("domain-a/runtime-a/session-a").unwrap(),
        refresh_interval: std::time::Duration::from_millis(1000),
        smoke_duration: std::time::Duration::from_millis(100),
        command: "runtime_session_view_snapshot".into(),
        message: String::new(),
    }
}

#[test]
fn state_aggregates_session_update() {
    let mut state = ConsoleState::default();
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new(
            "domain-a",
            Some("runtime-a".into()),
            Some("session-a".into()),
        ),
        SessionAddress::domain_only("domain-a"),
        "session_update",
        json!({"runtimeID":"runtime-a","sessionID":"session-a","title":"A","state":"running"}),
    ));
    let rows = state.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].runtime_id, "runtime-a");
    assert_eq!(rows[0].state, "running");
}

#[test]
fn render_includes_htop_style_columns() {
    let mut state = ConsoleState::default();
    state.insert_for_test(SessionRow {
        runtime_id: "runtime-a".into(),
        session_id: "session-a".into(),
        title: "Session A".into(),
        state: "running".into(),
        summary: "ready".into(),
        ..Default::default()
    });
    let text = render_to_string(&cfg(), &state);
    assert!(text.contains("GlassVein console-endpoint"));
    assert!(text.contains("RUNTIME ID"));
    assert!(text.contains("runtime-a"));
}

#[test]
fn control_envelopes_use_canonical_shape() {
    let env = build_control(
        "compact_session",
        "console-test",
        parse_address("domain-a/console/runtime").unwrap(),
        parse_address("domain-a/runtime-a/session-a").unwrap(),
        "",
    )
    .unwrap();
    let text = serde_json::to_string(&LinkMessage::Envelope(env)).unwrap();
    assert!(text.contains("control"));
    assert!(text.contains("compact_session"));
    assert!(!text.contains(&format!("{}{}{}", "control", ".", "command")));
}

#[test]
fn requests_use_canonical_source_target() {
    let req = build_request(
        "runtime_session_messages",
        parse_address("domain-a/console/runtime").unwrap(),
        parse_address("domain-a/runtime-a/session-a").unwrap(),
        "",
    )
    .unwrap();
    assert_eq!(req.link_type, "request");
    assert_eq!(req.subtype, "runtime_session_messages");
    assert_eq!(req.target.runtime.as_deref(), Some("runtime-a"));
}
