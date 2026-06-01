//! Parser tests for operator shell commands.

use super::super::*;

#[test]
fn parse_help() {
    assert_eq!(parse_command("help"), ShellCommand::Help);
    assert_eq!(parse_command("?"), ShellCommand::Help);
}

#[test]
fn parse_peers() {
    assert_eq!(parse_command("peers"), ShellCommand::Peers);
}

#[test]
fn parse_peer_show() {
    assert_eq!(
        parse_command("peer show peer-1"),
        ShellCommand::PeerShow {
            peer_id: "peer-1".into()
        }
    );
}

#[test]
fn parse_requests() {
    assert_eq!(parse_command("requests"), ShellCommand::Requests);
    assert_eq!(parse_command("req"), ShellCommand::Requests);
}

#[test]
fn parse_approve() {
    assert_eq!(
        parse_command("approve req-0 persist"),
        ShellCommand::Approve {
            request_id: "req-0".into(),
            kind: "persist".into(),
        }
    );
    assert_eq!(
        parse_command("approve req-1 ttl=600"),
        ShellCommand::Approve {
            request_id: "req-1".into(),
            kind: "ttl=600".into(),
        }
    );
}

#[test]
fn parse_deny() {
    assert_eq!(
        parse_command("deny req-0"),
        ShellCommand::Deny {
            request_id: "req-0".into()
        }
    );
}

#[test]
fn parse_routes() {
    assert_eq!(parse_command("routes"), ShellCommand::Routes);
}

#[test]
fn parse_route_add() {
    assert_eq!(
        parse_command("route add d1/*/* via n1 distance 5"),
        ShellCommand::RouteAdd {
            address: "d1/*/*".into(),
            peer: "n1".into(),
            distance: 5,
        }
    );
}

#[test]
fn parse_route_remove() {
    assert_eq!(
        parse_command("route remove d1/*/* via n1"),
        ShellCommand::RouteRemove {
            address: "d1/*/*".into(),
            peer: Some("n1".into()),
        }
    );
    assert_eq!(
        parse_command("route rm d1/*/*"),
        ShellCommand::RouteRemove {
            address: "d1/*/*".into(),
            peer: None,
        }
    );
}

#[test]
fn parse_rules() {
    assert_eq!(parse_command("rules"), ShellCommand::Rules);
}

#[test]
fn parse_rule_enable() {
    assert_eq!(
        parse_command("rule enable r1"),
        ShellCommand::RuleEnable {
            rule_id: "r1".into()
        }
    );
}

#[test]
fn parse_rule_disable() {
    assert_eq!(
        parse_command("rule disable r1"),
        ShellCommand::RuleDisable {
            rule_id: "r1".into()
        }
    );
}

#[test]
fn parse_rule_remove() {
    assert_eq!(
        parse_command("rule remove r1"),
        ShellCommand::RuleRemove {
            rule_id: "r1".into()
        }
    );
}

#[test]
fn parse_dry_run() {
    assert_eq!(
        parse_command("dry-run some args"),
        ShellCommand::DryRun {
            args: "some args".into()
        }
    );
}

#[test]
fn parse_tail() {
    assert_eq!(parse_command("tail"), ShellCommand::Tail);
}

#[test]
fn parse_quit() {
    assert_eq!(parse_command("quit"), ShellCommand::Quit);
    assert_eq!(parse_command("exit"), ShellCommand::Quit);
}

#[test]
fn parse_unknown() {
    assert_eq!(
        parse_command("foobar baz"),
        ShellCommand::Unknown {
            input: "foobar baz".into()
        }
    );
}

#[test]
fn parse_empty() {
    assert_eq!(
        parse_command(""),
        ShellCommand::Unknown { input: "".into() }
    );
    assert_eq!(
        parse_command("   "),
        ShellCommand::Unknown {
            input: "".into()
        }
    );
}

#[test]
fn parse_trims_whitespace() {
    assert_eq!(parse_command("  help  "), ShellCommand::Help);
}

#[test]
fn shell_output_display() {
    let out = ShellOutput::ok("hello");
    assert_eq!(format!("{out}"), "hello");
    assert!(!out.is_error);

    let out = ShellOutput::error("bad");
    assert_eq!(format!("{out}"), "bad");
    assert!(out.is_error);
}

#[test]
fn parse_address_valid() {
    assert_eq!(parse_address("d1").unwrap().domain, "d1");
    assert_eq!(
        parse_address("d1/rt1").unwrap().runtime.as_deref(),
        Some("rt1")
    );
    assert_eq!(
        parse_address("d1/rt1/s1").unwrap().session.as_deref(),
        Some("s1")
    );
}

#[test]
fn parse_address_invalid() {
    assert!(parse_address("a/b/c/d").is_err());
}
