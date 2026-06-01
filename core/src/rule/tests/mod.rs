//! Rule table tests.
//!
//! Split into sub-modules for maintainability (each ≤ 500 lines).

mod lifecycle;
mod matcher;

use super::*;
use osgp::SessionAddress;

fn addr(domain: &str, runtime: Option<&str>, session: Option<&str>) -> SessionAddress {
    SessionAddress::new(
        domain,
        runtime.map(String::from),
        session.map(String::from),
    )
}

fn ctx<'a>(
    source: &'a SessionAddress,
    target: &'a SessionAddress,
    link_type: &'a str,
    from_neighbor: Option<&'a str>,
    ttl: u8,
) -> RuleContext<'a> {
    RuleContext {
        source,
        target,
        link_type,
        subtype: "test",
        kind: "test",
        from_neighbor,
        ttl,
    }
}

fn make_rule(id: &str, priority: u32, action: RuleAction) -> Rule {
    Rule {
        id: id.to_string(),
        priority,
        enabled: true,
        matcher: RuleMatcher::default(),
        action,
        revision: 0,
    }
}

fn drop_rule(id: &str, priority: u32) -> Rule {
    make_rule(
        id,
        priority,
        RuleAction::Drop {
            reason: format!("{id} hit"),
        },
    )
}
