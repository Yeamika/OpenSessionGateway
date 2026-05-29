//! bash-clientdummy — Bash/stdin-driven dummy runtime client for OSGP demos.
//!
//! Connects to a router via WebSocket, performs LinkHandshake, announces
//! sessions, sends initial session_update, then enters an interactive loop
//! reading stdin commands and handling inbound messages.
//!
//! ## Usage
//!
//! ```text
//! bash-clientdummy --router-url ws://127.0.0.1:7201 \
//!   --node-id alpha-client --domain east \
//!   --runtime runtime-alpha \
//!   --session session-alpha-1 --session session-alpha-2 \
//!   --stay-alive --interactive
//! ```

mod handler;
mod protocol;

use std::collections::HashMap;
use std::env;
use std::io::{self, BufRead};

use anyhow::Result;
use osgp::{LinkMessage, SessionAddress, SessionState};
use osgp_client::{Transport, WebSocketTransportHandle};
use tokio::time::{Duration, Instant};
use tracing::info;

use handler::{handle_message, SessionStateTracker};
use protocol::{
    build_announce, build_link_handshake_json, build_session_update_envelope, format_address,
    make_session_address,
};

// ── CLI ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct Args {
    pub router_url: String,
    pub node_id: String,
    pub domain: String,
    pub runtime: String,
    pub sessions: Vec<String>,
    pub stay_alive: bool,
    pub interactive: bool,
    pub listen_seconds: u64,
}

impl Args {
    /// Build the base runtime-level address (domain/runtime/*).
    pub fn runtime_address(&self) -> SessionAddress {
        SessionAddress::new(
            &self.domain,
            Some(self.runtime.clone()),
            None,
        )
    }

    /// Build a session-level address for a given session ID.
    pub fn session_address(&self, session_id: &str) -> SessionAddress {
        make_session_address(&self.domain, &self.runtime, session_id)
    }

    /// Validate CLI args.
    pub fn validate(&self) -> Result<()> {
        if self.node_id.is_empty() {
            anyhow::bail!("--node-id must not be empty");
        }
        if self.domain.is_empty() {
            anyhow::bail!("--domain must not be empty");
        }
        if self.runtime.is_empty() {
            anyhow::bail!("--runtime must not be empty");
        }
        if self.sessions.is_empty() {
            anyhow::bail!("at least one --session is required");
        }
        for s in &self.sessions {
            if s.is_empty() {
                anyhow::bail!("--session value must not be empty");
            }
        }
        Ok(())
    }
}

fn parse_args() -> Result<Args> {
    let mut router_url = "ws://127.0.0.1:7201".to_string();
    let mut node_id = "bash-clientdummy".to_string();
    let mut domain = "east".to_string();
    let mut runtime = "runtime-alpha".to_string();
    let mut sessions: Vec<String> = Vec::new();
    let mut stay_alive = false;
    let mut interactive = false;
    let mut listen_seconds: u64 = 60;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--router-url" => {
                router_url = take_value(&mut args, "--router-url")?;
            }
            "--node-id" => {
                node_id = take_value(&mut args, "--node-id")?;
            }
            "--domain" => {
                domain = take_value(&mut args, "--domain")?;
            }
            "--runtime" => {
                runtime = take_value(&mut args, "--runtime")?;
            }
            "--session" => {
                sessions.push(take_value(&mut args, "--session")?);
            }
            "--stay-alive" => {
                stay_alive = true;
            }
            "--stdin" | "--interactive" => {
                interactive = true;
            }
            "--listen-seconds" => {
                listen_seconds = take_value(&mut args, "--listen-seconds")?.parse()?;
            }
            "--once" => {
                let a = Args {
                    router_url: router_url.clone(),
                    node_id: node_id.clone(),
                    domain: domain.clone(),
                    runtime: runtime.clone(),
                    sessions: if sessions.is_empty() {
                        vec!["session-alpha-1".into()]
                    } else {
                        sessions.clone()
                    },
                    stay_alive,
                    interactive,
                    listen_seconds,
                };
                println!(
                    "Config: node_id={} domain={} runtime={} sessions={:?} router_url={} interactive={} stay_alive={}",
                    a.node_id, a.domain, a.runtime, a.sessions, a.router_url, a.interactive, a.stay_alive
                );
                std::process::exit(0);
            }
            other => anyhow::bail!("unknown argument '{other}', use --help"),
        }
    }

    if sessions.is_empty() {
        sessions.push("session-alpha-1".into());
    }

    let args = Args {
        router_url,
        node_id,
        domain,
        runtime,
        sessions,
        stay_alive,
        interactive,
        listen_seconds,
    };
    args.validate()?;
    Ok(args)
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .ok_or_else(|| anyhow::anyhow!("{flag} requires a value"))
}

fn print_help() {
    println!("Usage: bash-clientdummy [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --router-url <url>       WebSocket router URL (default: ws://127.0.0.1:7201)");
    println!("  --node-id <id>           Client node ID (default: bash-clientdummy)");
    println!("  --domain <domain>        OSGP domain (default: east)");
    println!("  --runtime <runtime>      OSGP runtime ID (default: runtime-alpha)");
    println!("  --session <id>           Session ID (repeatable; default: session-alpha-1)");
    println!("  --stay-alive             Keep running indefinitely (sets listen to 24h)");
    println!("  --stdin / --interactive  Enable line-based stdin commands");
    println!("  --listen-seconds <n>     Listen window in seconds (default: 60)");
    println!("  --once                   Print config and exit");
    println!("  -h, --help               Show this help");
    println!();
    println!("Stdin commands (--interactive):");
    println!("  update <session> <state>  Send session_update (running/active/idle/closed)");
    println!("  message <session> <text>  Append local message log entry");
    println!("  close <session>           Send session_update state=closed");
    println!("  help                      Show stdin help");
    println!("  quit                      Exit");
}

// ── Stdin Commands ───────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StdinCommand {
    Update {
        session: String,
        state: SessionState,
    },
    Message {
        session: String,
        text: String,
    },
    Close {
        session: String,
    },
    Help,
    Quit,
}

/// Parse a line of stdin into a StdinCommand.
pub fn parse_stdin_command(line: &str) -> Option<StdinCommand> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut parts = trimmed.splitn(3, ' ');
    let cmd = parts.next()?;
    match cmd {
        "update" => {
            let session = parts.next()?.to_string();
            let state_str = parts.next()?;
            let state = match state_str.to_lowercase().as_str() {
                "running" => SessionState::Running,
                "active" => SessionState::Active,
                "idle" => SessionState::Idle,
                "closed" => SessionState::Closed,
                _ => return None,
            };
            Some(StdinCommand::Update { session, state })
        }
        "message" => {
            let session = parts.next()?.to_string();
            let text = parts.next()?.to_string();
            Some(StdinCommand::Message { session, text })
        }
        "close" => {
            let session = parts.next()?.to_string();
            Some(StdinCommand::Close { session })
        }
        "help" => Some(StdinCommand::Help),
        "quit" | "exit" => Some(StdinCommand::Quit),
        _ => None,
    }
}

fn print_stdin_help() {
    println!("Commands:");
    println!("  update <session> <state>  Send session_update (running/active/idle/closed)");
    println!("  message <session> <text>  Append local message log entry");
    println!("  close <session>           Send session_update state=closed");
    println!("  help                      Show this help");
    println!("  quit                      Exit");
}

// ── Main ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = parse_args()?;

    println!("==============================================================");
    println!("  bash-clientdummy — stdin-driven OSGP runtime client");
    println!("  node_id    = {}", args.node_id);
    println!("  domain     = {}", args.domain);
    println!("  runtime    = {}", args.runtime);
    println!("  sessions   = {:?}", args.sessions);
    println!("  router_url = {}", args.router_url);
    println!("  interactive= {}", args.interactive);
    println!("  stay_alive = {}", args.stay_alive);
    println!("  pid        = {}", std::process::id());
    println!("==============================================================");
    println!();

    // [1] Connect
    println!("[1/5] Connecting to router at {}...", args.router_url);
    let transport = WebSocketTransportHandle::connect(&args.router_url).await?;
    println!("  OK: WebSocket connected");

    // [2] LinkHandshake
    println!("[2/5] Sending LinkHandshake...");
    let hs_json = build_link_handshake_json(&args.node_id)?;
    transport.send_raw_text(&hs_json).await?;
    println!("  OK: LinkHandshake sent (peer_id={})", args.node_id);
    // Try to read handshake reply (non-blocking)
    match tokio::time::timeout(Duration::from_millis(500), transport.receive_raw_text()).await {
        Ok(Ok(Some(reply))) => info!(reply = %reply, "received router handshake reply"),
        _ => info!("no handshake reply from router (normal for downstream)"),
    }

    // [3] Announce each session
    println!("[3/5] Announcing sessions...");
    for sid in &args.sessions {
        let addr = args.session_address(sid);
        transport.send_message(build_announce(&addr)).await?;
        println!("  OK: Announce {}", format_address(&addr));
    }

    // [4] Initial session_update for each session
    println!("[4/5] Sending initial session_update...");
    let mut sessions: HashMap<String, SessionStateTracker> = HashMap::new();
    for sid in &args.sessions {
        let addr = args.session_address(sid);
        let env = build_session_update_envelope(
            &args.node_id,
            &addr,
            sid,
            SessionState::Running,
            Some(&format!("session {sid}")),
            Some("dummy client session"),
        );
        let msg_id = env.message_id.clone();
        transport
            .send_message(LinkMessage::TypedEnvelope(env))
            .await?;
        println!("  OK: session_update sent for {} (msg_id={})", sid, msg_id);

        let mut tracker = SessionStateTracker::new(sid);
        tracker.title = format!("session {sid}");
        sessions.insert(sid.clone(), tracker);
    }

    // [5] Main loop: stdin + receive
    let listen_duration = if args.stay_alive {
        Duration::from_secs(24 * 3600)
    } else {
        Duration::from_secs(args.listen_seconds)
    };

    println!(
        "[5/5] Main loop ({}s, interactive={})...",
        listen_duration.as_secs(),
        args.interactive
    );

    if args.interactive {
        run_interactive_loop(&transport, &args, &mut sessions, listen_duration).await?;
    } else {
        run_passive_loop(&transport, &args, &mut sessions, listen_duration).await?;
    }

    println!("Done.");
    Ok(())
}

/// Passive loop: only receive inbound messages, no stdin.
async fn run_passive_loop(
    transport: &WebSocketTransportHandle,
    args: &Args,
    sessions: &mut HashMap<String, SessionStateTracker>,
    duration: Duration,
) -> Result<()> {
    let deadline = Instant::now() + duration;
    let mut seen = 0usize;

    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match tokio::time::timeout(deadline - now, transport.receive_message()).await {
            Ok(Ok(Some(message))) => {
                seen += 1;
                handle_message(
                    transport,
                    &args.node_id,
                    &args.runtime,
                    &args.runtime_address(),
                    sessions,
                    message,
                )
                .await?;
            }
            Ok(Ok(None)) => {
                println!("  WARN: router connection closed");
                break;
            }
            Ok(Err(err)) => {
                println!("  ERR: receive error: {err}");
                break;
            }
            Err(_) => break,
        }
    }

    println!("  OK: passive loop ended; messages processed = {seen}");
    Ok(())
}

/// Interactive loop: select on stdin + inbound messages.
async fn run_interactive_loop(
    transport: &WebSocketTransportHandle,
    args: &Args,
    sessions: &mut HashMap<String, SessionStateTracker>,
    duration: Duration,
) -> Result<()> {
    let deadline = Instant::now() + duration;

    // Channel for stdin lines
    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Spawn blocking stdin reader
    std::thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(text) => {
                    if stdin_tx.send(text).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    println!("  Type 'help' for commands, 'quit' to exit.");

    loop {
        let now = Instant::now();
        if now >= deadline {
            println!("  Listen deadline reached.");
            break;
        }

        tokio::select! {
            biased;

            // Stdin input
            Some(line) = stdin_rx.recv() => {
                match parse_stdin_command(&line) {
                    Some(StdinCommand::Update { session, state }) => {
                        let addr = args.session_address(&session);
                        let env = build_session_update_envelope(
                            &args.node_id, &addr, &session, state.clone(), None, None,
                        );
                        transport.send_message(LinkMessage::TypedEnvelope(env)).await?;
                        if let Some(tracker) = sessions.get_mut(&session) {
                            tracker.state = state;
                        }
                        println!("  TX session_update for {} -> {:?}", session, sessions.get(&session).map(|t| &t.state));
                    }
                    Some(StdinCommand::Message { session, text }) => {
                        if let Some(tracker) = sessions.get_mut(&session) {
                            tracker.messages.push(("user".into(), text.clone()));
                            println!("  LOG [{}] user: {}", session, text);
                        } else {
                            println!("  WARN: unknown session '{}'", session);
                        }
                    }
                    Some(StdinCommand::Close { session }) => {
                        let addr = args.session_address(&session);
                        let env = build_session_update_envelope(
                            &args.node_id, &addr, &session, SessionState::Closed, None, None,
                        );
                        transport.send_message(LinkMessage::TypedEnvelope(env)).await?;
                        if let Some(tracker) = sessions.get_mut(&session) {
                            tracker.state = SessionState::Closed;
                        }
                        println!("  TX session_update(closed) for {}", session);
                    }
                    Some(StdinCommand::Help) => {
                        print_stdin_help();
                    }
                    Some(StdinCommand::Quit) => {
                        println!("  Quitting.");
                        break;
                    }
                    None => {
                        // empty or unparseable
                        println!("  Unknown command. Type 'help' for commands.");
                    }
                }
            }

            // Inbound from router
            result = tokio::time::timeout(deadline - Instant::now(), transport.receive_message()) => {
                match result {
                    Ok(Ok(Some(message))) => {
                        handle_message(
                            transport,
                            &args.node_id,
                            &args.runtime,
                            &args.runtime_address(),
                            sessions,
                            message,
                        ).await?;
                    }
                    Ok(Ok(None)) => {
                        println!("  WARN: router connection closed");
                        break;
                    }
                    Ok(Err(err)) => {
                        println!("  ERR: receive error: {err}");
                        break;
                    }
                    Err(_) => {
                        println!("  Listen deadline reached.");
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

// ── Unit Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── CLI args tests ───────────────────────────────────────────────

    #[test]
    fn test_args_session_address() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "n1".into(),
            domain: "east".into(),
            runtime: "rt-1".into(),
            sessions: vec!["s1".into()],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        let addr = args.session_address("s1");
        assert_eq!(addr.domain, "east");
        assert_eq!(addr.runtime.as_deref(), Some("rt-1"));
        assert_eq!(addr.session.as_deref(), Some("s1"));
    }

    #[test]
    fn test_args_runtime_address() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "n1".into(),
            domain: "west".into(),
            runtime: "rt-2".into(),
            sessions: vec!["s1".into()],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        let addr = args.runtime_address();
        assert_eq!(addr.domain, "west");
        assert_eq!(addr.runtime.as_deref(), Some("rt-2"));
        assert!(addr.session.is_none());
    }

    #[test]
    fn test_args_validate_empty_node_id() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "".into(),
            domain: "east".into(),
            runtime: "rt-1".into(),
            sessions: vec!["s1".into()],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        assert!(args.validate().is_err());
    }

    #[test]
    fn test_args_validate_empty_sessions() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "n1".into(),
            domain: "east".into(),
            runtime: "rt-1".into(),
            sessions: vec![],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        assert!(args.validate().is_err());
    }

    #[test]
    fn test_args_validate_multiple_sessions() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "n1".into(),
            domain: "east".into(),
            runtime: "rt-1".into(),
            sessions: vec!["s1".into(), "s2".into(), "s3".into()],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        assert!(args.validate().is_ok());
        assert_eq!(args.sessions.len(), 3);
    }

    // ── Stdin command parsing tests ──────────────────────────────────

    #[test]
    fn test_parse_update_command() {
        let cmd = parse_stdin_command("update session-alpha-1 running");
        assert_eq!(
            cmd,
            Some(StdinCommand::Update {
                session: "session-alpha-1".into(),
                state: SessionState::Running,
            })
        );
    }

    #[test]
    fn test_parse_update_idle() {
        let cmd = parse_stdin_command("update s1 idle");
        assert_eq!(
            cmd,
            Some(StdinCommand::Update {
                session: "s1".into(),
                state: SessionState::Idle,
            })
        );
    }

    #[test]
    fn test_parse_update_active() {
        let cmd = parse_stdin_command("update s1 active");
        assert_eq!(
            cmd,
            Some(StdinCommand::Update {
                session: "s1".into(),
                state: SessionState::Active,
            })
        );
    }

    #[test]
    fn test_parse_close_command() {
        let cmd = parse_stdin_command("close session-alpha-1");
        assert_eq!(
            cmd,
            Some(StdinCommand::Close {
                session: "session-alpha-1".into(),
            })
        );
    }

    #[test]
    fn test_parse_message_command() {
        let cmd = parse_stdin_command("message session-alpha-1 hello world");
        assert_eq!(
            cmd,
            Some(StdinCommand::Message {
                session: "session-alpha-1".into(),
                text: "hello world".into(),
            })
        );
    }

    #[test]
    fn test_parse_help_command() {
        assert_eq!(parse_stdin_command("help"), Some(StdinCommand::Help));
    }

    #[test]
    fn test_parse_quit_command() {
        assert_eq!(parse_stdin_command("quit"), Some(StdinCommand::Quit));
        assert_eq!(parse_stdin_command("exit"), Some(StdinCommand::Quit));
    }

    #[test]
    fn test_parse_empty_line() {
        assert_eq!(parse_stdin_command(""), None);
        assert_eq!(parse_stdin_command("   "), None);
    }

    #[test]
    fn test_parse_unknown_command() {
        assert_eq!(parse_stdin_command("foobar baz"), None);
    }

    #[test]
    fn test_parse_update_invalid_state() {
        assert_eq!(parse_stdin_command("update s1 bogus"), None);
    }

    #[test]
    fn test_parse_update_missing_args() {
        assert_eq!(parse_stdin_command("update"), None);
        assert_eq!(parse_stdin_command("update s1"), None);
    }

    #[test]
    fn test_parse_close_missing_session() {
        assert_eq!(parse_stdin_command("close"), None);
    }

    #[test]
    fn test_parse_message_missing_args() {
        assert_eq!(parse_stdin_command("message"), None);
        assert_eq!(parse_stdin_command("message s1"), None);
    }

    // ── Multi-session address tests ──────────────────────────────────

    #[test]
    fn test_multi_session_addresses_distinct() {
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "alpha-client".into(),
            domain: "east".into(),
            runtime: "runtime-alpha".into(),
            sessions: vec![
                "session-alpha-1".into(),
                "session-alpha-2".into(),
                "session-alpha-3".into(),
            ],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };

        let addrs: Vec<SessionAddress> = args
            .sessions
            .iter()
            .map(|s| args.session_address(s))
            .collect();

        // All share domain/runtime
        for a in &addrs {
            assert_eq!(a.domain, "east");
            assert_eq!(a.runtime.as_deref(), Some("runtime-alpha"));
        }
        // Sessions are distinct
        assert_ne!(addrs[0].session, addrs[1].session);
        assert_ne!(addrs[1].session, addrs[2].session);
        assert_ne!(addrs[0].session, addrs[2].session);
    }

    #[test]
    fn test_multi_session_announce_builds() {
        use protocol::build_announce;
        let args = Args {
            router_url: "ws://localhost:7201".into(),
            node_id: "n1".into(),
            domain: "east".into(),
            runtime: "rt-1".into(),
            sessions: vec!["s1".into(), "s2".into()],
            stay_alive: false,
            interactive: false,
            listen_seconds: 60,
        };
        for sid in &args.sessions {
            let addr = args.session_address(sid);
            let msg = build_announce(&addr);
            match msg {
                LinkMessage::Announce { address, distance } => {
                    assert_eq!(address.session.as_deref(), Some(sid.as_str()));
                    assert_eq!(distance, 0);
                }
                _ => panic!("expected Announce"),
            }
        }
    }
}
