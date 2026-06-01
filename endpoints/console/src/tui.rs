use std::{
    io::{self, Read, Write},
    sync::mpsc,
    thread,
};

use anyhow::Result;
use futures_util::StreamExt;
use osgp::LinkMessage;
use tokio::time;

use crate::{
    admin::{self, format_admin_response},
    client::{handle_ping, read_link_message, send_admin_request, send_link},
    config::{format_address, normalize_command, Config},
    control::build_control,
    request::{build_request, is_request_command},
    state::{now_stamp, ConsoleState, SessionRow},
};

pub async fn run_tui(config: Config) -> Result<()> {
    let (mut writer, mut reader) = crate::client::connect_console(&config).await?;
    let (input_tx, input_rx) = mpsc::channel();
    spawn_input_reader(input_tx);
    let mut state = ConsoleState::default();
    let mut ticker = time::interval(config.refresh_interval);
    let mut screen = ScreenGuard::enter()?;
    render(&mut screen, &config, &state)?;
    loop {
        tokio::select! {
            _ = ticker.tick() => render(&mut screen, &config, &state)?,
            msg = reader.next() => {
                let Some(msg) = msg else { break; };
                if let Ok(msg) = msg {
                    apply_message(&mut state, read_link_message(msg), &mut writer).await?;
                }
                render(&mut screen, &config, &state)?;
            }
            _ = tokio::signal::ctrl_c() => break,
        }
        while let Ok(line) = input_rx.try_recv() {
            if handle_input(&line, &config, &mut state, &mut writer).await? {
                return Ok(());
            }
            render(&mut screen, &config, &state)?;
        }
    }
    Ok(())
}

pub async fn apply_message(
    state: &mut ConsoleState,
    message: Option<LinkMessage>,
    writer: &mut crate::client::Writer,
) -> Result<()> {
    match message {
        Some(LinkMessage::Envelope(envelope)) => {
            // Admin response is an internal admin plane exception — NOT a
            // canonical business subtype. Handle it separately from normal
            // business message processing.
            if let Some(admin_resp) = admin::parse_admin_response(&envelope) {
                state.last_admin_response = Some(format_admin_response(&admin_resp));
                state.events.push(format!(
                    "admin response: ok={}",
                    admin_resp.ok
                ));
            } else {
                // Normal business envelope — apply to state via canonical allowlist
                state.apply_session_envelope(&envelope);
            }
        }
        Some(LinkMessage::TypedEnvelope(envelope)) => state.apply_typed_envelope(&envelope),
        Some(LinkMessage::ReadResponse(response)) => state.apply_read_response(&response),
        Some(LinkMessage::Ping) => handle_ping(writer).await?,
        _ => {}
    }
    Ok(())
}

async fn handle_input(
    line: &str,
    config: &Config,
    state: &mut ConsoleState,
    writer: &mut crate::client::Writer,
) -> Result<bool> {
    let trimmed = line.trim();
    match trimmed {
        "q" | "quit" | "exit" => return Ok(true),
        "j" | "down" => state.move_selection(1),
        "k" | "up" => state.move_selection(-1),
        "view" => send_request("runtime_session_view_snapshot", config, state, writer).await?,
        "messages" => send_request("runtime_session_messages", config, state, writer).await?,
        "requestions" => send_request("runtime_requestion_snapshot", config, state, writer).await?,
        "workspace" => {
            send_request("runtime_workspace_view_snapshot", config, state, writer).await?
        }
        "abort" => {
            send_control("abort_session", config, state, writer, "abort from console").await?
        }
        "resume" => send_control("resume_session", config, state, writer, "").await?,
        "compact" => send_control("compact_session", config, state, writer, "").await?,
        // ── Admin read-only commands (always available) ─────────────
        "admin routes" => {
            send_admin_request(writer, config, &admin::request_route_list()).await?;
            state.events.push("admin: route_list".into());
        }
        "admin routes manual" => {
            send_admin_request(writer, config, &admin::request_route_list_manual()).await?;
            state.events.push("admin: route_list_manual".into());
        }
        "admin rules" => {
            send_admin_request(writer, config, &admin::request_rule_list()).await?;
            state.events.push("admin: rule_list".into());
        }
        "admin revision" => {
            send_admin_request(writer, config, &admin::request_revision()).await?;
            state.events.push("admin: revision".into());
        }
        // ── Admin write commands (requires --enable-admin-write) ───
        _ if trimmed.starts_with("admin route add ") => {
            if !config.enable_admin_write {
                state.events.push(
                    "ADMIN WRITE DISABLED: use --enable-admin-write to enable route/rule modifications"
                        .into(),
                );
                return Ok(false);
            }
            // Format: admin route add <domain/runtime/session> <neighbor> <distance>
            let parts: Vec<&str> = trimmed[16..].split_whitespace().collect();
            if parts.len() >= 3 {
                let addr = crate::config::parse_address(parts[0])?;
                let neighbor = parts[1];
                let distance: u32 = parts[2].parse().unwrap_or(1);
                send_admin_request(
                    writer,
                    config,
                    &admin::request_route_add(addr, neighbor, distance),
                )
                .await?;
                state.events.push(format!(
                    "admin: route_add {} → {} d={}",
                    parts[0], neighbor, distance
                ));
            } else {
                state.events.push("usage: admin route add <addr> <neighbor> <distance>".into());
            }
        }
        _ if trimmed.starts_with("admin route remove ") => {
            if !config.enable_admin_write {
                state.events.push(
                    "ADMIN WRITE DISABLED: use --enable-admin-write to enable route/rule modifications"
                        .into(),
                );
                return Ok(false);
            }
            // Format: admin route remove <domain/runtime/session> <neighbor>
            let parts: Vec<&str> = trimmed[19..].split_whitespace().collect();
            if parts.len() >= 2 {
                let addr = crate::config::parse_address(parts[0])?;
                let neighbor = parts[1];
                send_admin_request(
                    writer,
                    config,
                    &admin::request_route_remove(addr, neighbor),
                )
                .await?;
                state.events.push(format!(
                    "admin: route_remove {} → {}",
                    parts[0], neighbor
                ));
            } else {
                state.events.push("usage: admin route remove <addr> <neighbor>".into());
            }
        }
        _ if trimmed.starts_with("admin rule remove ") => {
            if !config.enable_admin_write {
                state.events.push(
                    "ADMIN WRITE DISABLED: use --enable-admin-write to enable route/rule modifications"
                        .into(),
                );
                return Ok(false);
            }
            let id = &trimmed[18..];
            send_admin_request(writer, config, &admin::request_rule_remove(id)).await?;
            state.events.push(format!("admin: rule_remove {id}"));
        }
        // ── Existing commands ───────────────────────────────────────
        _ if trimmed.starts_with("prompt ") => {
            send_control("add_prompt", config, state, writer, &trimmed[7..]).await?
        }
        _ if trimmed.starts_with("rename ") => {
            send_control("rename_session", config, state, writer, &trimmed[7..]).await?
        }
        _ if trimmed.starts_with("create ") => {
            send_control("create_session", config, state, writer, &trimmed[7..]).await?
        }
        _ if !trimmed.is_empty() => state.events.push(format!("unknown command: {trimmed}")),
        _ => {}
    }
    Ok(false)
}

async fn send_request(
    command: &str,
    config: &Config,
    state: &ConsoleState,
    writer: &mut crate::client::Writer,
) -> Result<()> {
    let target = selected_target(config, state);
    let request = build_request(command, config.address.clone(), target, "")?;
    send_link(writer, LinkMessage::ReadRequest(request)).await
}

async fn send_control(
    command: &str,
    config: &Config,
    state: &ConsoleState,
    writer: &mut crate::client::Writer,
    message: &str,
) -> Result<()> {
    let target = selected_target(config, state);
    let envelope = build_control(
        command,
        &config.node_id,
        config.address.clone(),
        target,
        message,
    )?;
    send_link(writer, LinkMessage::Envelope(envelope)).await
}

pub async fn send_configured_command(
    config: &Config,
    writer: &mut crate::client::Writer,
) -> Result<()> {
    let command = normalize_command(&config.command);

    // Admin commands (sent as admin.request envelopes)
    if is_admin_command(&command) {
        // Guard: admin write commands require --enable-admin-write
        if is_admin_write_command(&command) && !config.enable_admin_write {
            anyhow::bail!(
                "admin write command '{}' requires --enable-admin-write flag. \
                 Use --enable-admin-write to explicitly authorize route/rule modifications.",
                command
            );
        }
        let admin_req = build_admin_command(&command, &config.message)?;
        send_admin_request(writer, config, &admin_req).await?;
        return Ok(());
    }

    if is_request_command(&command) {
        let req = build_request(
            &command,
            config.address.clone(),
            config.target.clone(),
            &config.message,
        )?;
        send_link(writer, LinkMessage::ReadRequest(req)).await
    } else {
        let env = build_control(
            &command,
            &config.node_id,
            config.address.clone(),
            config.target.clone(),
            &config.message,
        )?;
        send_link(writer, LinkMessage::Envelope(env)).await
    }
}

fn selected_target(config: &Config, state: &ConsoleState) -> osgp::SessionAddress {
    if let Some(row) = state.selected_row() {
        osgp::SessionAddress::new(
            &config.target.domain,
            Some(row.runtime_id),
            Some(row.session_id),
        )
    } else {
        config.target.clone()
    }
}

pub fn render_to_string(config: &Config, state: &ConsoleState) -> String {
    let rows = state.rows();
    let mut out = String::new();
    out.push_str(&format!(
        "GlassVein console-endpoint  router={} source={} target={}\n",
        config.router_url,
        format_address(&config.address),
        format_address(&config.target)
    ));
    out.push_str(&format!(
        "Updated: {} sessions={} pending={} refresh={}ms\n",
        now_stamp(),
        state.len(),
        state.pending_count(),
        config.refresh_interval.as_millis()
    ));
    out.push_str("Keys/commands: j/k move, view, messages, requestions, workspace, abort, resume, compact, prompt <text>, rename <title>, create <prompt>, q\n");
    out.push_str("Admin commands: admin routes, admin routes manual, admin rules, admin revision, admin route add <addr> <neighbor> <dist>, admin route remove <addr> <neighbor>, admin rule remove <id>\n\n");
    out.push_str(&format!(
        "{:<2} {:<18} {:<22} {:<24} {:<10} {:<16} {}\n",
        "", "RUNTIME ID", "SESSION ID", "TITLE", "STATE", "LAST UPDATE", "SUMMARY/PENDING"
    ));
    out.push_str(&format!("{}\n", "-".repeat(122)));
    if rows.is_empty() {
        out.push_str("<no sessions observed yet>\n");
    } else {
        for (index, row) in rows.iter().take(30).enumerate() {
            out.push_str(&format_row(row, index == state.selected));
        }
    }
    out.push_str("\nDETAIL\n");
    out.push_str(
        &state
            .selected_row()
            .map(|r| r.detail)
            .unwrap_or_else(|| "<none>".into()),
    );
    out.push_str("\n\nADMIN RESPONSE\n");
    out.push_str(
        &state
            .last_admin_response
            .as_deref()
            .unwrap_or("<none>"),
    );
    out.push_str("\n\nEVENTS\n");
    for event in &state.events {
        out.push_str(event);
        out.push('\n');
    }
    out
}

fn render(screen: &mut ScreenGuard, config: &Config, state: &ConsoleState) -> Result<()> {
    write!(
        screen.out,
        "\x1b[H\x1b[2J{}",
        render_to_string(config, state)
    )?;
    screen.out.flush()?;
    Ok(())
}

fn format_row(row: &SessionRow, selected: bool) -> String {
    format!(
        "{:<2} {:<18} {:<22} {:<24} {:<10} {:<16} {}\n",
        if selected { ">" } else { "" },
        trunc(&row.runtime_id, 18),
        trunc(&row.session_id, 22),
        trunc(&row.title, 24),
        trunc(&row.state, 10),
        trunc(&row.last_update, 16),
        trunc(&row.summary, 80)
    )
}

fn trunc(value: &str, width: usize) -> String {
    let mut chars: Vec<char> = value.chars().collect();
    if chars.len() <= width {
        return value.to_string();
    }
    chars.truncate(width.saturating_sub(1));
    chars.push('…');
    chars.into_iter().collect()
}

// ── Admin command helpers ────────────────────────────────────────────

/// Check if a command is an admin read-only command.
pub fn is_admin_read_command(command: &str) -> bool {
    matches!(
        command,
        "admin_route_list" | "admin_route_list_manual" | "admin_rule_list" | "admin_revision"
    )
}

/// Check if a command is an admin write command (requires --enable-admin-write).
pub fn is_admin_write_command(command: &str) -> bool {
    matches!(
        command,
        "admin_route_add" | "admin_route_remove" | "admin_rule_remove"
    )
}

/// Check if a command is any admin command (read or write).
fn is_admin_command(command: &str) -> bool {
    is_admin_read_command(command) || is_admin_write_command(command)
}

/// Check if a TUI input line is an admin write command.
pub fn is_admin_write_input(line: &str) -> bool {
    line.starts_with("admin route add ")
        || line.starts_with("admin route remove ")
        || line.starts_with("admin rule remove ")
}

fn build_admin_command(command: &str, message: &str) -> Result<admin::AdminRequest> {
    match command {
        "admin_route_list" => Ok(admin::request_route_list()),
        "admin_route_list_manual" => Ok(admin::request_route_list_manual()),
        "admin_rule_list" => Ok(admin::request_rule_list()),
        "admin_revision" => Ok(admin::request_revision()),
        "admin_route_add" => {
            // message format: "addr neighbor distance"
            let parts: Vec<&str> = message.split_whitespace().collect();
            if parts.len() < 3 {
                anyhow::bail!("admin_route_add requires: --message '<addr> <neighbor> <distance>'");
            }
            let addr = crate::config::parse_address(parts[0])?;
            let distance: u32 = parts[2].parse()?;
            Ok(admin::request_route_add(addr, parts[1], distance))
        }
        "admin_route_remove" => {
            // message format: "addr neighbor"
            let parts: Vec<&str> = message.split_whitespace().collect();
            if parts.len() < 2 {
                anyhow::bail!("admin_route_remove requires: --message '<addr> <neighbor>'");
            }
            let addr = crate::config::parse_address(parts[0])?;
            Ok(admin::request_route_remove(addr, parts[1]))
        }
        "admin_rule_remove" => Ok(admin::request_rule_remove(message)),
        other => anyhow::bail!("unknown admin command: {other}"),
    }
}

fn spawn_input_reader(tx: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut stdin = io::stdin();
        let mut buf = [0_u8; 1];
        let mut line = String::new();
        while stdin.read(&mut buf).ok() == Some(1) {
            let ch = buf[0] as char;
            if ch == '\n' || ch == '\r' {
                let _ = tx.send(line.clone());
                line.clear();
            } else if ch == 'q' && line.is_empty() {
                let _ = tx.send("q".into());
                break;
            } else {
                line.push(ch);
            }
        }
    });
}

struct ScreenGuard {
    out: io::Stdout,
}

impl ScreenGuard {
    fn enter() -> Result<Self> {
        let mut out = io::stdout();
        write!(out, "\x1b[?1049h\x1b[?25l")?;
        out.flush()?;
        Ok(Self { out })
    }
}

impl Drop for ScreenGuard {
    fn drop(&mut self) {
        let _ = write!(self.out, "\x1b[?25h\x1b[?1049l");
        let _ = self.out.flush();
    }
}
