//! Demo B: Control Surface — send targeted commands to sessions.
//!
//! Shows how a control surface builds addprompt / abort / compact
//! envelopes and parses a response.  No transport needed.
//!
//!     cargo run -p glassvein-demos --bin control-demo

use osgp::SessionAddress;
use serde_json::json;
use surface::{ControlCommand, ControlSurface};

fn format_addr(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

fn main() {
    println!("=== GlassVein Control Surface Demo ===\n");

    // ── 1. Create control surface ──
    let cs = ControlSurface::new(
        "control-surface-1",
        SessionAddress::new(
            "glassvein-control",
            Some("ctrl-runtime".into()),
            Some("ctrl-session".into()),
        ),
    );
    println!("[control] node_id={}", cs.node_id);
    println!("[control] address={}", format_addr(&cs.address));

    // ── 2. Target address ──
    let target = SessionAddress::new(
        "default",
        Some("target-runtime".into()),
        Some("target-session".into()),
    );
    println!("[control] target={}\n", format_addr(&target));

    // ── 3. Build addprompt envelope ──
    println!("--- addprompt ---");
    let env = cs.build_addprompt(
        target.clone(),
        "Hello from control surface!",
        Some("You are a helpful assistant"),
        Some("my-app"),
    );
    println!("  type/subtype={}/{}", env.link_type, env.subtype);
    println!("  source={}", format_addr(&env.source));
    println!("  target={}", format_addr(&env.target));
    println!("  ttl={}", env.ttl);
    println!(
        "  payload={}",
        serde_json::to_string_pretty(&env.payload).unwrap()
    );

    let cmd: ControlCommand = serde_json::from_value(env.payload.clone()).unwrap();
    match cmd {
        ControlCommand::AddPrompt {
            session_id: _,
            msg,
            system,
            source,
        } => {
            println!("  -> parsed: msg={msg:?}, system={system:?}, source={source:?}");
        }
        _ => panic!("expected AddPrompt"),
    }

    // ── 4. Build abort envelope ──
    println!("\n--- abort ---");
    let env2 = cs.build_abort(target.clone(), Some("session unresponsive"));
    println!("  type/subtype={}/{}", env2.link_type, env2.subtype);
    println!(
        "  payload={}",
        serde_json::to_string_pretty(&env2.payload).unwrap()
    );

    // ── 5. Build compact envelope ──
    println!("\n--- compact ---");
    let env3 = cs.build_compact(target.clone(), Some(true));
    println!("  type/subtype={}/{}", env3.link_type, env3.subtype);
    println!(
        "  payload={}",
        serde_json::to_string_pretty(&env3.payload).unwrap()
    );

    // ── 6. Parse a simulated response ──
    println!("\n--- parse response ---");
    // Construct a simulated response envelope.
    // NOTE: `kind` is a compat field; routing uses `link_type` + `subtype`.
    let reply = osgp::SessionEnvelope {
        id: uuid::Uuid::new_v4(),
        source: target,
        target: cs.address.clone(),
        link_type: "response".to_string(),
        subtype: "add_prompt".to_string(),
        kind: "control.add_prompt".to_string(), // compat — kept for backward-compatible deserialization
        payload: json!({
            "success": true,
            "message": "Prompt added to session",
            "data": {"session_id": "target-session"}
        }),
        ttl: 32,
        route_hops: vec![],
        origin_surface: None,
    };
    match ControlSurface::parse_response(&reply) {
        Some(resp) => {
            println!("  command={}", resp.command);
            println!("  success={}", resp.success);
            println!("  message={:?}", resp.message);
            println!("  data={:?}", resp.data);
        }
        None => println!("  (failed to parse response)"),
    }

    println!("\n=== Demo B Complete ===");
}
