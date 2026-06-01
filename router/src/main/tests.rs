//! CLI argument parsing tests for the router binary.

use super::*;

fn args(items: &[&str]) -> std::vec::IntoIter<String> {
    items.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter()
}

#[test]
fn cli_defaults() {
    let cli = parse_args_from(args(&[])).unwrap();
    assert_eq!(cli.node_id, "root-router");
    assert_eq!(cli.bind_addr, "127.0.0.1:7200");
    assert!(cli.upstream_urls.is_empty());
    assert_eq!(cli.tap_capacity, Some(128));
    assert!(cli.state_file.is_none());
    assert!(!cli.operator_shell);
}

#[test]
fn cli_node_id_and_bind() {
    let cli = parse_args_from(args(&["--node-id", "my-router", "--bind-addr", "0.0.0.0:9000"])).unwrap();
    assert_eq!(cli.node_id, "my-router");
    assert_eq!(cli.bind_addr, "0.0.0.0:9000");
}

#[test]
fn cli_upstream_url_append() {
    let cli = parse_args_from(args(&["--upstream-url", "ws://a:1", "--upstream", "ws://b:2"])).unwrap();
    assert_eq!(cli.upstream_urls, vec!["ws://a:1", "ws://b:2"]);
}

#[test]
fn cli_upstream_urls_csv() {
    let cli = parse_args_from(args(&["--upstream-urls", "ws://a:1, ws://b:2"])).unwrap();
    assert_eq!(cli.upstream_urls, vec!["ws://a:1", "ws://b:2"]);
}

#[test]
fn cli_clear_upstreams() {
    let cli = parse_args_from(args(&[
        "--upstream-url", "ws://a:1",
        "--upstream-url", "ws://b:2",
        "--clear-upstreams",
        "--upstream-url", "ws://c:3",
    ]))
    .unwrap();
    assert_eq!(cli.upstream_urls, vec!["ws://c:3"]);
}

#[test]
fn cli_tap_capacity() {
    let cli = parse_args_from(args(&["--tap-capacity", "256"])).unwrap();
    assert_eq!(cli.tap_capacity, Some(256));
}

#[test]
fn cli_disable_tap() {
    let cli = parse_args_from(args(&["--disable-tap"])).unwrap();
    assert!(cli.tap_capacity.is_none());
}

#[test]
fn cli_state_file() {
    let cli = parse_args_from(args(&["--state-file", "/tmp/state.json"])).unwrap();
    assert_eq!(cli.state_file, Some(PathBuf::from("/tmp/state.json")));
}

#[test]
fn cli_operator_shell_flag() {
    let cli = parse_args_from(args(&["--operator-shell"])).unwrap();
    assert!(cli.operator_shell);
}

#[test]
fn cli_admin_shell_alias() {
    let cli = parse_args_from(args(&["--admin-shell"])).unwrap();
    assert!(cli.operator_shell);
}

#[test]
fn cli_combined_flags() {
    let cli = parse_args_from(args(&[
        "--node-id", "router-1",
        "--bind-addr", "0.0.0.0:8000",
        "--upstream-url", "ws://parent:7200",
        "--state-file", "/tmp/r1.json",
        "--operator-shell",
        "--tap-capacity", "64",
    ]))
    .unwrap();
    assert_eq!(cli.node_id, "router-1");
    assert_eq!(cli.bind_addr, "0.0.0.0:8000");
    assert_eq!(cli.upstream_urls, vec!["ws://parent:7200"]);
    assert_eq!(cli.state_file, Some(PathBuf::from("/tmp/r1.json")));
    assert!(cli.operator_shell);
    assert_eq!(cli.tap_capacity, Some(64));
}

#[test]
fn cli_unknown_flag_errors() {
    let result = parse_args_from(args(&["--bogus"]));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unknown argument"));
}

#[test]
fn cli_empty_node_id_errors() {
    let result = parse_args_from(args(&["--node-id", ""]));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("must not be empty"));
}

#[test]
fn cli_empty_bind_addr_errors() {
    let result = parse_args_from(args(&["--bind-addr", "  "]));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("must not be empty"));
}

#[test]
fn cli_missing_value_errors() {
    let result = parse_args_from(args(&["--node-id"]));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("requires a value"));
}

#[test]
fn cli_invalid_tap_capacity_errors() {
    let result = parse_args_from(args(&["--tap-capacity", "abc"]));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("invalid --tap-capacity"));
}

#[test]
fn format_rule_action_all_variants() {
    use gv_core::RuleAction;
    assert_eq!(format_rule_action(&RuleAction::Drop { reason: "evil".into() }), "drop:evil");
    assert_eq!(format_rule_action(&RuleAction::ForceNeighbor { neighbor_id: "n1".into() }), "force:n1");
    assert_eq!(format_rule_action(&RuleAction::DenyNeighbor { neighbor_id: "n2".into() }), "deny:n2");
    assert_eq!(format_rule_action(&RuleAction::Continue), "continue");
}
