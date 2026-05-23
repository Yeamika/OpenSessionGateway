//! Demo A: Observer Surface — subscribe to envelope observations.
//!
//! Shows how an observer surface filters and receives control-command
//! observations.  No transport needed — all events are emitted locally.
//!
//!     cargo run -p glassvein-demos --bin observer-demo

use serde_json::json;
use osgp::{SessionAddress, SessionEnvelope};
use surface::{Direction, Observation, ObserverFilter, ObserverSurface};

fn format_addr(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

#[tokio::main]
async fn main() {
    println!("=== GlassVein Observer Surface Demo ===\n");

    // ── 1. Create observer with filter: only "add_prompt" subtype ──
    // NOTE: `kind_filter` is the crate field name; it matches `envelope.subtype`
    // (and compat `envelope.kind`) for filtering.
    let (observer, mut rx) = ObserverSurface::with_filter(
        256,
        ObserverFilter {
            kind_filter: Some("add_prompt".to_string()),
            ..Default::default()
        },
    );
    println!("[observer] created with filter: subtype=add_prompt");
    println!(
        "[observer] subscriber_count={}",
        observer.subscriber_count()
    );

    // ── 2. Simulate router emitting observations ──

    // This one will be filtered out (wrong subtype)
    let ping_obs = Observation {
        envelope: SessionEnvelope::new(
            SessionAddress::new("app", Some("rt-a".into()), None),
            SessionAddress::new("app", Some("rt-b".into()), None),
            "demo.ping",
            json!({"from": "rt-a"}),
        ),
        direction: Direction::ForwardPeer,
        forwarded_to: Some("peer-b".to_string()),
        observed_at: 1700000001.0,
        note: None,
        origin_router_id: Some("demo-router".to_string()),
    };
    let _ = observer.emit(ping_obs);
    println!("[router] emitted demo.ping (filtered out)");

    // This one passes the filter — subtype resolves to "add_prompt" via canonical_type_subtype
    let control_obs = Observation {
        envelope: SessionEnvelope::new(
            SessionAddress::new("ctrl", Some("ctrl-rt".into()), Some("ctrl-ses".into())),
            SessionAddress::new("app", Some("rt-b".into()), Some("ses-1".into())),
            "add_prompt",
            json!({"msg": "Hello from control!", "source": "demo"}),
        ),
        direction: Direction::ForwardPeer,
        forwarded_to: Some("peer-b".to_string()),
        observed_at: 1700000002.0,
        note: Some("control command forwarded".to_string()),
        origin_router_id: Some("demo-router".to_string()),
    };
    let _ = observer.emit(control_obs);
    println!("[router] emitted add_prompt (passes filter)");

    // Another control command (abort) — filtered out because subtype != add_prompt
    let abort_obs = Observation {
        envelope: SessionEnvelope::new(
            SessionAddress::new("ctrl", Some("ctrl-rt".into()), Some("ctrl-ses".into())),
            SessionAddress::new("app", Some("rt-c".into()), Some("ses-2".into())),
            "abort_session",
            json!({"reason": "timeout"}),
        ),
        direction: Direction::LocalDelivery,
        forwarded_to: None,
        observed_at: 1700000003.0,
        note: None,
        origin_router_id: Some("demo-router".to_string()),
    };
    let _ = observer.emit(abort_obs);
    println!("[router] emitted abort_session (filtered out)");

    // ── 3. Observer receives events ──
    println!("\n[observer] reading events from channel...\n");

    drop(observer); // close sender so rx drains and ends

    let mut count = 0;
    while let Ok(obs) = rx.recv().await {
        count += 1;
        let subtype = &obs.envelope.subtype;
        let target = format_addr(&obs.envelope.target);
        let dir = serde_json::to_string(&obs.direction).unwrap_or_default();
        println!(
            "  [#{count}] time={:.1} dir={dir} subtype={subtype} target={target}",
            obs.observed_at,
        );
        if let Some(to) = &obs.forwarded_to {
            println!("         forwarded_to={to}");
        }
        if let Some(note) = &obs.note {
            println!("         note={note}");
        }
    }

    println!("\n[observer] received {count} observations (expected 1 — only add_prompt subtype)");
    println!("=== Demo A Complete ===");
}
