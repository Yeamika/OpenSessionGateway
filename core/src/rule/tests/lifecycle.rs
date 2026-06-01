//! Lifecycle, evaluation, action, snapshot, and revision tests for rule table.

use super::*;

// ── Add / remove / list ──

#[test]
fn add_rule_and_list() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    table.add_rule(drop_rule("r2", 5));

    let rules = table.list_rules();
    assert_eq!(rules.len(), 2);
    // Sorted by priority: r2 (5) before r1 (10)
    assert_eq!(rules[0].id, "r2");
    assert_eq!(rules[1].id, "r1");
}

#[test]
fn add_rule_replaces_existing() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    table.add_rule(make_rule("r1", 20, RuleAction::Continue));

    let rules = table.list_rules();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].priority, 20);
    assert_eq!(rules[0].action, RuleAction::Continue);
}

#[test]
fn remove_rule() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    assert!(table.remove_rule("r1"));
    assert!(table.is_empty());
}

#[test]
fn remove_nonexistent_returns_false() {
    let mut table = RuleTable::default();
    assert!(!table.remove_rule("nobody"));
}

// ── Enable / disable ──

#[test]
fn enable_disable_rule() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));

    assert!(table.disable_rule("r1"));
    let rule = table.get_rule("r1").unwrap();
    assert!(!rule.enabled);

    assert!(table.enable_rule("r1"));
    let rule = table.get_rule("r1").unwrap();
    assert!(rule.enabled);
}

#[test]
fn disable_already_disabled_no_change() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    assert!(table.disable_rule("r1"));
    assert!(!table.disable_rule("r1")); // no change
}

// ── Evaluation ──

#[test]
fn evaluate_first_matching_rule_wins() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.link_type = Some("upload".into());
    let mut r2 = drop_rule("r2", 5);
    r2.matcher.link_type = Some("upload".into());
    table.add_rule(r1);
    table.add_rule(r2);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "upload", None, 32);

    let action = table.evaluate(&context).unwrap();
    // r2 has lower priority (5) so it wins
    match action {
        RuleAction::Drop { reason } => assert!(reason.contains("r2")),
        other => panic!("expected Drop r2, got: {:?}", other),
    }
}

#[test]
fn evaluate_skips_disabled_rules() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.link_type = Some("upload".into());
    table.add_rule(r1);
    table.disable_rule("r1");

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "upload", None, 32);

    assert!(table.evaluate(&context).is_none());
}

#[test]
fn evaluate_no_match_returns_none() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.link_type = Some("control".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "upload", None, 32);

    assert!(table.evaluate(&context).is_none());
}

// ── Actions ──

#[test]
fn action_force_neighbor() {
    let mut table = RuleTable::default();
    let mut r1 = make_rule(
        "r1",
        10,
        RuleAction::ForceNeighbor {
            neighbor_id: "preferred".into(),
        },
    );
    r1.matcher.link_type = Some("control".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "control", None, 32);

    let action = table.evaluate(&context).unwrap();
    assert_eq!(
        action,
        RuleAction::ForceNeighbor {
            neighbor_id: "preferred".into()
        }
    );
}

#[test]
fn action_deny_neighbor() {
    let mut table = RuleTable::default();
    let mut r1 = make_rule(
        "r1",
        10,
        RuleAction::DenyNeighbor {
            neighbor_id: "blocked".into(),
        },
    );
    r1.matcher.from_neighbor = Some("n1".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "upload", Some("n1"), 32);

    let action = table.evaluate(&context).unwrap();
    assert_eq!(
        action,
        RuleAction::DenyNeighbor {
            neighbor_id: "blocked".into()
        }
    );
}

#[test]
fn action_continue() {
    let mut table = RuleTable::default();
    let mut r1 = make_rule("r1", 10, RuleAction::Continue);
    r1.matcher.kind = Some("pass".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);
    let context = RuleContext {
        source: &src,
        target: &tgt,
        link_type: "upload",
        subtype: "test",
        kind: "pass",
        from_neighbor: None,
        ttl: 32,
    };

    let action = table.evaluate(&context).unwrap();
    assert_eq!(action, RuleAction::Continue);
}

// ── Snapshot ──

#[test]
fn snapshot_returns_all_rules() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    table.add_rule(make_rule("r2", 5, RuleAction::Continue));
    table.disable_rule("r2");

    let snap = table.snapshot();
    assert_eq!(snap.len(), 2);
    // Sorted by priority
    assert_eq!(snap[0].id, "r2");
    assert!(!snap[0].enabled);
    assert_eq!(snap[1].id, "r1");
    assert!(snap[1].enabled);
}

// ── Revision ──

#[test]
fn revision_starts_at_zero() {
    let table = RuleTable::default();
    assert_eq!(table.revision(), 0);
}

#[test]
fn revision_bumps_on_add() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    assert_eq!(table.revision(), 1);
}

#[test]
fn revision_bumps_on_remove() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    table.remove_rule("r1");
    assert_eq!(table.revision(), 2);
}

#[test]
fn revision_bumps_on_enable_disable() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    table.disable_rule("r1");
    table.enable_rule("r1");
    assert_eq!(table.revision(), 3);
}

#[test]
fn revision_no_bump_when_no_change() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    let rev = table.revision();
    // Remove non-existent
    table.remove_rule("nobody");
    assert_eq!(table.revision(), rev);
    // Disable already disabled — wait, it IS enabled, so disable should bump.
    // Let's test enable when already enabled instead.
    table.enable_rule("r1"); // already enabled → no bump
    assert_eq!(table.revision(), rev);
}

// ── get_rule ──

#[test]
fn get_rule_by_id() {
    let mut table = RuleTable::default();
    table.add_rule(drop_rule("r1", 10));
    assert!(table.get_rule("r1").is_some());
    assert!(table.get_rule("nobody").is_none());
}

// ── len / is_empty ──

#[test]
fn len_and_is_empty() {
    let mut table = RuleTable::default();
    assert!(table.is_empty());
    assert_eq!(table.len(), 0);

    table.add_rule(drop_rule("r1", 10));
    assert!(!table.is_empty());
    assert_eq!(table.len(), 1);
}
