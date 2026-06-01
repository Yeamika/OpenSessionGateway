//! Matcher tests for rule table.

use super::*;

// ── Matcher: link_type ──

#[test]
fn matcher_link_type() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.link_type = Some("control".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    // Match
    let context = ctx(&src, &tgt, "control", None, 32);
    assert!(table.evaluate(&context).is_some());

    // No match
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_none());
}

// ── Matcher: subtype ──

#[test]
fn matcher_subtype() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.subtype = Some("session_update".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    let context = RuleContext {
        source: &src,
        target: &tgt,
        link_type: "upload",
        subtype: "session_update",
        kind: "test",
        from_neighbor: None,
        ttl: 32,
    };
    assert!(table.evaluate(&context).is_some());

    let context = RuleContext {
        source: &src,
        target: &tgt,
        link_type: "upload",
        subtype: "other",
        kind: "test",
        from_neighbor: None,
        ttl: 32,
    };
    assert!(table.evaluate(&context).is_none());
}

// ── Matcher: kind (legacy) ──

#[test]
fn matcher_kind() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.kind = Some("control.open".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    let context = RuleContext {
        source: &src,
        target: &tgt,
        link_type: "control",
        subtype: "open",
        kind: "control.open",
        from_neighbor: None,
        ttl: 32,
    };
    assert!(table.evaluate(&context).is_some());

    let context = RuleContext {
        source: &src,
        target: &tgt,
        link_type: "control",
        subtype: "open",
        kind: "control.close",
        from_neighbor: None,
        ttl: 32,
    };
    assert!(table.evaluate(&context).is_none());
}

// ── Matcher: from_neighbor ──

#[test]
fn matcher_from_neighbor() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.from_neighbor = Some("evil-peer".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    // From evil-peer → match
    let context = ctx(&src, &tgt, "upload", Some("evil-peer"), 32);
    assert!(table.evaluate(&context).is_some());

    // From good-peer → no match
    let context = ctx(&src, &tgt, "upload", Some("good-peer"), 32);
    assert!(table.evaluate(&context).is_none());

    // No from_neighbor → no match
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_none());
}

// ── Matcher: TTL range ──

#[test]
fn matcher_ttl_range() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.ttl_min = Some(5);
    r1.matcher.ttl_max = Some(10);
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    // TTL in range
    let context = ctx(&src, &tgt, "upload", None, 7);
    assert!(table.evaluate(&context).is_some());

    // TTL below range
    let context = ctx(&src, &tgt, "upload", None, 3);
    assert!(table.evaluate(&context).is_none());

    // TTL above range
    let context = ctx(&src, &tgt, "upload", None, 15);
    assert!(table.evaluate(&context).is_none());
}

// ── Matcher: source/target address ──

#[test]
fn matcher_source_address() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.source_address = Some(addr("evil", None, None));
    table.add_rule(r1);

    let evil = addr("evil", None, None);
    let good = addr("good", None, None);
    let tgt = addr("d2", None, None);

    let context = ctx(&evil, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_some());

    let context = ctx(&good, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_none());
}

#[test]
fn matcher_target_address_wildcard() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    // Match any address in domain "d1" regardless of runtime/session
    r1.matcher.target_address = Some(addr("d1", None, None));
    table.add_rule(r1);

    let src = addr("src", None, None);

    // Exact domain match
    let tgt = addr("d1", None, None);
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_some());

    // Domain + runtime
    let tgt = addr("d1", Some("rt1"), None);
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_some());

    // Domain + runtime + session
    let tgt = addr("d1", Some("rt1"), Some("s1"));
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_some());

    // Different domain
    let tgt = addr("d2", None, None);
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_none());
}

#[test]
fn matcher_target_address_specific_runtime() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.target_address = Some(addr("d1", Some("rt1"), None));
    table.add_rule(r1);

    let src = addr("src", None, None);

    // Same domain + runtime
    let tgt = addr("d1", Some("rt1"), Some("s1"));
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_some());

    // Same domain, different runtime
    let tgt = addr("d1", Some("rt2"), None);
    let context = ctx(&src, &tgt, "upload", None, 32);
    assert!(table.evaluate(&context).is_none());
}

// ── Combined matchers (AND logic) ──

#[test]
fn matcher_and_logic_all_must_match() {
    let mut table = RuleTable::default();
    let mut r1 = drop_rule("r1", 10);
    r1.matcher.link_type = Some("upload".into());
    r1.matcher.from_neighbor = Some("n1".into());
    table.add_rule(r1);

    let src = addr("d1", None, None);
    let tgt = addr("d2", None, None);

    // Both match
    let context = ctx(&src, &tgt, "upload", Some("n1"), 32);
    assert!(table.evaluate(&context).is_some());

    // Only link_type matches
    let context = ctx(&src, &tgt, "upload", Some("n2"), 32);
    assert!(table.evaluate(&context).is_none());

    // Only from_neighbor matches
    let context = ctx(&src, &tgt, "control", Some("n1"), 32);
    assert!(table.evaluate(&context).is_none());
}
