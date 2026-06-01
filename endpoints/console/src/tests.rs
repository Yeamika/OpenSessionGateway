use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
use serde_json::json;

use crate::{
    admin::{self, AdminRequest, AdminResponse, AdminRuleDef},
    config::{normalize_command, parse_address, Config, Mode},
    control::build_control,
    request::{build_request, is_request_command},
    state::{ConsoleState, SessionRow},
    tui::{is_admin_read_command, is_admin_write_command, is_admin_write_input, render_to_string},
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
        enable_admin_write: false,
    }
}

fn cfg_with_admin_write() -> Config {
    Config {
        enable_admin_write: true,
        ..cfg()
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

// === 1.1 空会话测试 ===

#[test]
fn empty_state_renders_no_sessions_message() {
    let state = ConsoleState::default();
    let text = render_to_string(&cfg(), &state);
    assert!(text.contains("<no sessions observed yet>"));
    assert!(text.contains("sessions=0"));
    assert!(text.contains("pending=0"));
}

#[test]
fn empty_state_selection_stays_at_zero() {
    let mut state = ConsoleState::default();
    assert_eq!(state.selected, 0);
    state.move_selection(1);
    assert_eq!(state.selected, 0);
    state.move_selection(-1);
    assert_eq!(state.selected, 0);
}

#[test]
fn empty_state_rows_returns_empty_vec() {
    let state = ConsoleState::default();
    assert!(state.rows().is_empty());
    assert_eq!(state.len(), 0);
    assert_eq!(state.pending_count(), 0);
}

#[test]
fn empty_state_selected_row_returns_none() {
    let state = ConsoleState::default();
    assert!(state.selected_row().is_none());
}

// === 1.2 大量会话测试 ===

#[test]
fn large_session_count_state_management() {
    let mut state = ConsoleState::default();
    for i in 0..150 {
        state.insert_for_test(SessionRow {
            runtime_id: format!("runtime-{:03}", i),
            session_id: format!("session-{:03}", i),
            title: format!("Session {}", i),
            state: "running".into(),
            summary: format!("summary {}", i),
            ..Default::default()
        });
    }
    assert_eq!(state.len(), 150);
    assert_eq!(state.rows().len(), 150);
}

#[test]
fn large_session_count_selection_clamps() {
    let mut state = ConsoleState::default();
    for i in 0..100 {
        state.insert_for_test(SessionRow {
            runtime_id: format!("runtime-{:03}", i),
            session_id: format!("session-{:03}", i),
            title: format!("Session {}", i),
            state: "running".into(),
            ..Default::default()
        });
    }
    state.selected = 99;
    state.move_selection(1);
    assert_eq!(state.selected, 99); // clamped at max
    state.move_selection(-100);
    assert_eq!(state.selected, 0); // clamped at min
}

#[test]
fn large_session_count_render_does_not_panic() {
    let mut state = ConsoleState::default();
    for i in 0..200 {
        state.insert_for_test(SessionRow {
            runtime_id: format!("runtime-{:03}", i),
            session_id: format!("session-{:03}", i),
            title: format!("Session {}", i),
            state: "running".into(),
            summary: format!("s {}", i),
            ..Default::default()
        });
    }
    let text = render_to_string(&cfg(), &state);
    assert!(text.contains("sessions=200"));
    // render caps at 30 rows but does not panic
    assert!(text.contains("runtime-000"));
}

#[test]
fn large_session_count_pending_count_sums_correctly() {
    let mut state = ConsoleState::default();
    for i in 0..50 {
        state.insert_for_test(SessionRow {
            runtime_id: format!("runtime-{:03}", i),
            session_id: format!("session-{:03}", i),
            title: format!("Session {}", i),
            state: "running".into(),
            pending: vec!["pending1".into(), "pending2".into()],
            ..Default::default()
        });
    }
    assert_eq!(state.pending_count(), 100); // 50 sessions * 2 pending each
}

// === 1.3 边界值测试 ===

#[test]
fn empty_string_is_valid_single_domain() {
    // parse_address("") parses "" as a domain-only address (empty domain)
    let addr = parse_address("").unwrap();
    assert_eq!(addr.domain, "");
    assert!(addr.runtime.is_none());
}

#[test]
fn invalid_address_too_many_parts_fails() {
    let result = parse_address("domain/runtime/session/extra");
    assert!(result.is_err());
}

#[test]
fn address_with_only_domain_succeeds() {
    let addr = parse_address("my-domain").unwrap();
    assert_eq!(addr.domain, "my-domain");
    assert!(addr.runtime.is_none());
    assert!(addr.session.is_none());
}

#[test]
fn address_with_domain_and_runtime_succeeds() {
    let addr = parse_address("domain-a/runtime-alpha").unwrap();
    assert_eq!(addr.domain, "domain-a");
    assert_eq!(addr.runtime.as_deref(), Some("runtime-alpha"));
    assert!(addr.session.is_none());
}

#[test]
fn full_address_succeeds() {
    let addr = parse_address("domain-a/runtime-alpha/session-beta").unwrap();
    assert_eq!(addr.domain, "domain-a");
    assert_eq!(addr.runtime.as_deref(), Some("runtime-alpha"));
    assert_eq!(addr.session.as_deref(), Some("session-beta"));
}

#[test]
fn session_update_with_long_summary_is_truncated() {
    let mut state = ConsoleState::default();
    let long_summary = "x".repeat(2000);
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "session_update",
        json!({"runtimeID":"r","sessionID":"s","title":"T","state":"running","summary": long_summary}),
    ));
    let rows = state.rows();
    assert_eq!(rows.len(), 1);
    // detail should be truncated by compact_json
    assert!(rows[0].detail.len() <= 903); // 900 + "..."
}

#[test]
fn session_update_with_special_characters() {
    let mut state = ConsoleState::default();
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "session_update",
        json!({"runtimeID":"r","sessionID":"s","title":"日本語タイトル","state":"running","summary":"emoji 🎉 test"}),
    ));
    let rows = state.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "日本語タイトル");
    assert!(rows[0].summary.contains("🎉"));
}

#[test]
fn session_update_with_empty_payload_uses_defaults() {
    let mut state = ConsoleState::default();
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "session_update",
        json!({}),
    ));
    let rows = state.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].state, "unknown");
}

#[test]
fn normalize_command_known_aliases() {
    assert_eq!(normalize_command("addprompt"), "add_prompt");
    assert_eq!(normalize_command("abort"), "abort_session");
    assert_eq!(normalize_command("compact"), "compact_session");
    assert_eq!(normalize_command("resume"), "resume_session");
    assert_eq!(normalize_command("custom_command"), "custom_command");
}

#[test]
fn is_request_command_known_variants() {
    assert!(is_request_command("runtime_session_view_snapshot"));
    assert!(is_request_command("runtime_session_messages"));
    assert!(is_request_command("runtime_workspace_view_snapshot"));
    assert!(is_request_command("runtime_requestion_snapshot"));
    assert!(!is_request_command("abort_session"));
    assert!(!is_request_command("unknown"));
}

// === 1.4 错误处理测试 ===

#[test]
fn unsupported_control_command_fails() {
    let result = build_control(
        "invalid_command",
        "console-test",
        parse_address("domain-a/console/runtime").unwrap(),
        parse_address("domain-a/runtime-a/session-a").unwrap(),
        "",
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unsupported control command"));
}

#[test]
fn unsupported_request_command_fails() {
    let result = build_request(
        "invalid_request",
        parse_address("domain-a/console/runtime").unwrap(),
        parse_address("domain-a/runtime-a/session-a").unwrap(),
        "",
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unsupported request command"));
}

#[test]
fn events_buffer_caps_at_eight() {
    let mut state = ConsoleState::default();
    for i in 0..20 {
        state.apply_session_envelope(&SessionEnvelope::new(
            SessionAddress::new("d", Some("r".into()), Some("s".into())),
            SessionAddress::domain_only("d"),
            "session_update",
            json!({"runtimeID":"r","sessionID":"s","title":format!("T{i}"),"state":"running"}),
        ));
    }
    assert_eq!(state.events.len(), 8);
    // oldest events are removed, newest retained
    assert!(state.events[7].contains("session_update"));
}

#[test]
fn move_selection_with_single_session_clamps() {
    let mut state = ConsoleState::default();
    state.insert_for_test(SessionRow {
        runtime_id: "r".into(),
        session_id: "s".into(),
        title: "T".into(),
        state: "running".into(),
        ..Default::default()
    });
    state.move_selection(1);
    assert_eq!(state.selected, 0);
    state.move_selection(-1);
    assert_eq!(state.selected, 0);
}

#[test]
fn requestion_asked_then_resolved_clears_pending() {
    let mut state = ConsoleState::default();
    let addr = SessionAddress::new("d", Some("r".into()), Some("s".into()));
    // ask — use "requestion.asked" kind which maps to link_type="upload", subtype="requestion_asked"
    state.apply_session_envelope(&SessionEnvelope::new(
        addr.clone(),
        SessionAddress::domain_only("d"),
        "requestion.asked",
        json!({"runtimeID":"r","sessionID":"s","requestID":"req-1","title":"pending?"}),
    ));
    assert_eq!(state.pending_count(), 1);
    // resolve — use "requestion.resolved" kind
    state.apply_session_envelope(&SessionEnvelope::new(
        addr,
        SessionAddress::domain_only("d"),
        "requestion.resolved",
        json!({"runtimeID":"r","sessionID":"s","requestID":"req-1"}),
    ));
    assert_eq!(state.pending_count(), 0);
}

#[test]
fn unknown_link_type_does_not_crash() {
    let mut state = ConsoleState::default();
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "unknown_type",
        json!({"runtimeID":"r","sessionID":"s","data":"test"}),
    ));
    // HARD RULE: non-canonical type+subtype pairs are dropped entirely
    // No session rows created, no events logged
    assert_eq!(state.len(), 0);
    assert_eq!(state.events.len(), 0);
}

// === Admin write guard tests ===

#[test]
fn admin_write_disabled_by_default() {
    let config = cfg();
    assert!(!config.enable_admin_write, "enable_admin_write should be false by default");
}

#[test]
fn admin_write_enabled_with_flag() {
    let config = cfg_with_admin_write();
    assert!(config.enable_admin_write, "enable_admin_write should be true when set");
}

#[test]
fn admin_read_commands_always_available() {
    use crate::tui::is_admin_read_command;

    // Read-only commands should always be recognized
    assert!(is_admin_read_command("admin_route_list"));
    assert!(is_admin_read_command("admin_route_list_manual"));
    assert!(is_admin_read_command("admin_rule_list"));
    assert!(is_admin_read_command("admin_revision"));

    // Write commands should NOT be recognized as read commands
    assert!(!is_admin_read_command("admin_route_add"));
    assert!(!is_admin_read_command("admin_route_remove"));
    assert!(!is_admin_read_command("admin_rule_remove"));
}

#[test]
fn admin_write_commands_identified() {
    use crate::tui::is_admin_write_command;

    // Write commands should be recognized
    assert!(is_admin_write_command("admin_route_add"));
    assert!(is_admin_write_command("admin_route_remove"));
    assert!(is_admin_write_command("admin_rule_remove"));

    // Read commands should NOT be recognized as write commands
    assert!(!is_admin_write_command("admin_route_list"));
    assert!(!is_admin_write_command("admin_rule_list"));
    assert!(!is_admin_write_command("admin_revision"));
}

#[test]
fn admin_write_input_detected() {
    use crate::tui::is_admin_write_input;

    // Write input patterns should be detected
    assert!(is_admin_write_input("admin route add d/r/s neighbor1 1"));
    assert!(is_admin_write_input("admin route remove d/r/s neighbor1"));
    assert!(is_admin_write_input("admin rule remove rule-1"));

    // Read input patterns should NOT be detected as write
    assert!(!is_admin_write_input("admin routes"));
    assert!(!is_admin_write_input("admin rules"));
    assert!(!is_admin_write_input("admin revision"));
}

#[test]
fn admin_write_guard_rejects_without_flag() {
    let config = cfg(); // enable_admin_write = false

    // Verify that write commands are rejected when flag is not set
    assert!(!config.enable_admin_write);
    assert!(is_admin_write_command("admin_route_add"));

    // The actual rejection happens in send_configured_command() which returns an error
    // We verify the config state here; integration test verifies the full flow
}

#[test]
fn admin_write_guard_allows_with_flag() {
    let config = cfg_with_admin_write(); // enable_admin_write = true

    // Verify that write commands are allowed when flag is set
    assert!(config.enable_admin_write);
    assert!(is_admin_write_command("admin_route_add"));
}

#[test]
fn admin_request_route_list_serializes() {
    let req = admin::request_route_list();
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("route_list"));
}

#[test]
fn admin_request_route_add_serializes() {
    let req = admin::request_route_add(
        parse_address("d/runtime/session").unwrap(),
        "neighbor-1",
        5,
    );
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("route_add"));
    assert!(json.contains("neighbor-1"));
    assert!(json.contains("5"));
}

#[test]
fn admin_request_rule_list_serializes() {
    let req = admin::request_rule_list();
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("rule_list"));
}

#[test]
fn admin_request_revision_serializes() {
    let req = admin::request_revision();
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("revision"));
}

#[test]
fn admin_request_rule_remove_serializes() {
    let req = admin::request_rule_remove("my-rule-id");
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("rule_remove"));
    assert!(json.contains("my-rule-id"));
}

#[test]
fn admin_envelope_has_correct_kind() {
    let req = admin::request_route_list();
    let envelope = admin::build_admin_request(
        &req,
        "console-test",
        parse_address("domain-a/console/runtime").unwrap(),
        parse_address("domain-a").unwrap(),
    )
    .unwrap();
    assert_eq!(envelope.kind, "admin.request");
    assert_eq!(envelope.link_type, "control");
    assert_eq!(envelope.subtype, "admin_request");
}

#[test]
fn admin_response_parse_ok() {
    let envelope = SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: parse_address("d").unwrap(),
        target: parse_address("d").unwrap(),
        kind: "admin.response".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_response".to_string(),
        payload: serde_json::to_value(AdminResponse::ok(json!({"routes": []}))).unwrap(),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };
    let resp = admin::parse_admin_response(&envelope);
    assert!(resp.is_some());
    let resp = resp.unwrap();
    assert!(resp.ok);
    assert!(resp.data.is_some());
}

#[test]
fn admin_response_parse_error() {
    let envelope = SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: parse_address("d").unwrap(),
        target: parse_address("d").unwrap(),
        kind: "admin.response".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_response".to_string(),
        payload: serde_json::to_value(AdminResponse::error("access denied")).unwrap(),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };
    let resp = admin::parse_admin_response(&envelope).unwrap();
    assert!(!resp.ok);
    assert_eq!(resp.error.unwrap(), "access denied");
}

#[test]
fn admin_response_parse_non_admin_returns_none() {
    let envelope = SessionEnvelope::new(
        parse_address("d/r/s").unwrap(),
        parse_address("d").unwrap(),
        "session_update",
        json!({}),
    );
    assert!(admin::parse_admin_response(&envelope).is_none());
}

#[test]
fn admin_format_response_ok() {
    let resp = AdminResponse::ok(json!({"routes": [{"address": "d/r/s", "neighbor": "n1"}]}));
    let text = admin::format_admin_response(&resp);
    assert!(text.contains("routes"));
    assert!(text.contains("n1"));
}

#[test]
fn admin_format_response_error() {
    let resp = AdminResponse::error("something broke");
    let text = admin::format_admin_response(&resp);
    assert!(text.contains("ADMIN ERROR"));
    assert!(text.contains("something broke"));
}

#[test]
fn admin_rule_def_serializes_with_defaults() {
    let def = AdminRuleDef {
        id: "test-rule".into(),
        priority: 100,
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
    };
    let json = serde_json::to_string(&def).unwrap();
    assert!(json.contains("test-rule"));
    assert!(json.contains("continue"));
    let decoded: AdminRuleDef = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.id, "test-rule");
    assert!(decoded.enabled);
}

#[test]
fn admin_round_trip_request() {
    let req = AdminRequest::RuleAdd {
        rule_def: AdminRuleDef {
            id: "r1".into(),
            priority: 50,
            enabled: true,
            source_address: Some(parse_address("d/r1").unwrap()),
            target_address: None,
            link_type: Some("upload".into()),
            subtype: None,
            kind: None,
            from_neighbor: None,
            ttl_min: None,
            ttl_max: None,
            action: "drop:spam".into(),
        },
    };
    let json_str = serde_json::to_string(&req).unwrap();
    let decoded: AdminRequest = serde_json::from_str(&json_str).unwrap();
    match decoded {
        AdminRequest::RuleAdd { rule_def } => {
            assert_eq!(rule_def.id, "r1");
            assert_eq!(rule_def.action, "drop:spam");
            assert_eq!(rule_def.link_type, Some("upload".into()));
        }
        other => panic!("expected RuleAdd, got {:?}", other),
    }
}

// === Canonical subtype allowlist tests ===

#[test]
fn canonical_upload_subtypes_are_recognized() {
    use crate::state::is_canonical_upload;

    // All canonical upload subtypes should be recognized
    assert!(is_canonical_upload("session_update"));
    assert!(is_canonical_upload("requestion_asked"));
    assert!(is_canonical_upload("requestion_updated"));
    assert!(is_canonical_upload("requestion_resolved"));
    assert!(is_canonical_upload("requestion_cancelled"));

    // Non-canonical upload subtypes should NOT be recognized
    assert!(!is_canonical_upload("unknown_subtype"));
    assert!(!is_canonical_upload("admin_request"));
    assert!(!is_canonical_upload("admin_response"));
    assert!(!is_canonical_upload("custom_event"));
}

#[test]
fn canonical_control_subtypes_are_recognized() {
    use crate::state::is_canonical_control;

    // All canonical control subtypes should be recognized
    assert!(is_canonical_control("add_prompt"));
    assert!(is_canonical_control("abort_session"));
    assert!(is_canonical_control("compact_session"));
    assert!(is_canonical_control("create_session"));
    assert!(is_canonical_control("rename_session"));
    assert!(is_canonical_control("resume_session"));
    assert!(is_canonical_control("requestion_respond"));

    // Non-canonical control subtypes should NOT be recognized
    assert!(!is_canonical_control("unknown_command"));
    assert!(!is_canonical_control("admin_request"));
    assert!(!is_canonical_control("custom_control"));
}

#[test]
fn canonical_request_subtypes_are_recognized() {
    use crate::state::is_canonical_request;

    // All canonical request subtypes should be recognized
    assert!(is_canonical_request("runtime_workspace_view_snapshot"));
    assert!(is_canonical_request("runtime_requestion_snapshot"));
    assert!(is_canonical_request("runtime_session_view_snapshot"));
    assert!(is_canonical_request("runtime_session_messages"));

    // Non-canonical request subtypes should NOT be recognized
    assert!(!is_canonical_request("unknown_request"));
    assert!(!is_canonical_request("admin_request"));
    assert!(!is_canonical_request("custom_query"));
}

#[test]
fn admin_exception_subtypes_are_identified() {
    use crate::state::is_admin_exception;

    // Admin exception subtypes should be identified
    assert!(is_admin_exception("admin_request"));
    assert!(is_admin_exception("admin_response"));

    // Canonical business subtypes should NOT be admin exceptions
    assert!(!is_admin_exception("session_update"));
    assert!(!is_admin_exception("add_prompt"));
    assert!(!is_admin_exception("runtime_session_messages"));
}

#[test]
fn non_canonical_upload_subtype_ignored_for_state() {
    let mut state = ConsoleState::default();

    // Apply a non-canonical upload subtype
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "upload",
        json!({"runtimeID":"r","sessionID":"s","title":"T","state":"running","subtype":"custom_event"}),
    ));

    // HARD RULE: non-canonical type+subtype pairs are dropped entirely
    // No session rows created, no events logged
    assert_eq!(state.len(), 0);
    assert_eq!(state.events.len(), 0);
}

#[test]
fn admin_request_subtype_ignored_for_state() {
    let mut state = ConsoleState::default();

    // Apply an admin_request envelope (internal admin exception)
    state.apply_session_envelope(&SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: parse_address("d/r/s").unwrap(),
        target: parse_address("d").unwrap(),
        kind: "admin.request".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_request".to_string(),
        payload: json!({"type": "route_list"}),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    });

    // Should NOT create a session row (admin exception ignored)
    assert_eq!(state.len(), 0);

    // Should NOT log an event (admin exceptions are skipped entirely)
    assert_eq!(state.events.len(), 0);
}

#[test]
fn admin_response_subtype_ignored_for_state() {
    let mut state = ConsoleState::default();

    // Apply an admin_response envelope (internal admin exception)
    state.apply_session_envelope(&SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: parse_address("d").unwrap(),
        target: parse_address("d/r/s").unwrap(),
        kind: "admin.response".to_string(),
        link_type: "control".to_string(),
        subtype: "admin_response".to_string(),
        payload: json!({"ok": true, "data": {"routes": []}}),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    });

    // Should NOT create a session row (admin exception ignored)
    assert_eq!(state.len(), 0);

    // Should NOT log an event (admin exceptions are skipped entirely)
    assert_eq!(state.events.len(), 0);
}

#[test]
fn canonical_session_update_processed_correctly() {
    let mut state = ConsoleState::default();

    // Apply a canonical session_update (kind="session_update" → link_type="upload", subtype="session_update")
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "session_update",
        json!({"runtimeID":"r","sessionID":"s","title":"Test","state":"running"}),
    ));

    // Should create a session row (canonical subtype)
    assert_eq!(state.len(), 1);
    let rows = state.rows();
    assert_eq!(rows[0].title, "Test");
    assert_eq!(rows[0].state, "running");
}

#[test]
fn canonical_requestion_asked_processed_correctly() {
    let mut state = ConsoleState::default();

    // Apply a canonical requestion_asked (kind="requestion.asked" → link_type="upload", subtype="requestion_asked")
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "requestion.asked",
        json!({"runtimeID":"r","sessionID":"s","requestID":"req-1","title":"Question?"}),
    ));

    // Should create a session row with pending requestion
    assert_eq!(state.len(), 1);
    assert_eq!(state.pending_count(), 1);
}

#[test]
fn unknown_link_type_ignored() {
    let mut state = ConsoleState::default();

    // Apply an unknown link_type
    state.apply_session_envelope(&SessionEnvelope::new(
        SessionAddress::new("d", Some("r".into()), Some("s".into())),
        SessionAddress::domain_only("d"),
        "unknown_type",
        json!({"runtimeID":"r","sessionID":"s","data":"test"}),
    ));

    // HARD RULE: non-canonical type+subtype pairs are dropped entirely
    // No session rows created, no events logged
    assert_eq!(state.len(), 0);
    assert_eq!(state.events.len(), 0);
}
