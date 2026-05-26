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
    client::{handle_ping, read_link_message, send_link},
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
        Some(LinkMessage::Envelope(envelope)) => state.apply_session_envelope(&envelope),
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
    out.push_str("Keys/commands: j/k move, view, messages, requestions, workspace, abort, resume, compact, prompt <text>, rename <title>, create <prompt>, q\n\n");
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
