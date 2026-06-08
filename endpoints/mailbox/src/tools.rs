use crate::mailbox::MailboxStore;
use anyhow::{bail, Result};
use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

/// Default domain used for mailbox endpoint addresses.
const DEFAULT_MAILBOX_DOMAIN: &str = "domain-a";

/// Arguments for the unified delivery handler.
#[derive(Clone, Debug)]
pub struct DeliveryArgs {
    pub recipient_runtime_id: String,
    pub recipient_session_id: String,
    pub sender_runtime_id: String,
    pub sender_session_id: String,
    pub sender_session_title: String,
    pub title: String,
    pub content: String,
    pub info_type: String, // "Notice" | "NeedReplay"
}

/// Result of a delivery operation.
#[derive(Clone, Debug)]
pub struct DeliveryResult {
    pub item_id: String,
    pub replay_id: Option<String>,
    /// Whether a reminder was sent to the recipient session.
    pub reminder_sent: bool,
}

#[derive(Clone, Debug)]
pub struct MailboxToolServices {
    mailbox: MailboxStore,
    /// Channel to send outbound OSGP envelopes (reminders + deliver).
    /// `None` when no router connection is available (local-only mode).
    outbound_tx: Option<mpsc::UnboundedSender<LinkMessage>>,
    /// Addresses this mailbox endpoint will accept inbound deliveries for.
    /// Used to match inbound `control/add_prompt` envelopes.
    receive_addresses: Vec<SessionAddress>,
    /// OSGP domain used for outbound mailbox envelopes.
    domain: String,
}

impl Default for MailboxToolServices {
    fn default() -> Self {
        Self {
            mailbox: MailboxStore::default(),
            outbound_tx: None,
            receive_addresses: Vec::new(),
            domain: DEFAULT_MAILBOX_DOMAIN.into(),
        }
    }
}

impl MailboxToolServices {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with an outbound channel (connected to router) and receive addresses.
    pub fn new_with_router(
        tx: mpsc::UnboundedSender<LinkMessage>,
        receive_addresses: Vec<SessionAddress>,
    ) -> Self {
        Self::new_with_router_domain(tx, receive_addresses, DEFAULT_MAILBOX_DOMAIN)
    }

    /// Create with an outbound channel and explicit OSGP domain.
    pub fn new_with_router_domain(
        tx: mpsc::UnboundedSender<LinkMessage>,
        receive_addresses: Vec<SessionAddress>,
        domain: impl Into<String>,
    ) -> Self {
        Self {
            mailbox: MailboxStore::default(),
            outbound_tx: Some(tx),
            receive_addresses,
            domain: clean_domain(domain),
        }
    }

    /// Get the receive addresses (for Announce and inbound matching).
    pub fn receive_addresses(&self) -> &[SessionAddress] {
        &self.receive_addresses
    }

    pub async fn call(&self, name: &str, args: Value) -> Result<Option<Value>> {
        validate_args(name, &args)?;
        let value = match name {
            "ListMailboxItems" => self.mailbox.list(&args).await,
            "ReadMailboxItem" => self.mailbox.read(&args).await,
            "SendMailboxItem" => self.handle_send_mailbox_item(&args).await,
            "ReplyMailboxItem" => self.mailbox.reply(&args).await,
            "DeleteMailboxItem" => self.mailbox.delete(&args).await,
            "MailboxReminders" => self.mailbox.reminders(&args).await,
            _ => return Ok(None),
        };
        Ok(Some(value))
    }

    /// Handle SendMailboxItem: if router connected, send `kind=deliver` to
    /// target's mailbox receive address; otherwise fall back to local store + reminder.
    async fn handle_send_mailbox_item(&self, args: &Value) -> Value {
        // If we have a router connection, send a deliver envelope to the target mailbox
        if let Some(ref tx) = self.outbound_tx {
            let deliver_envelope = build_deliver_envelope_with_domain(args, &self.domain);
            if tx.send(deliver_envelope).is_err() {
                tracing::warn!("failed to send deliver envelope (channel closed)");
                // Fall back to local store
                return self.local_send_and_remind(args).await;
            }
            // Return success — delivery status is NOT tracked.
            // The sender cannot know if the target mailbox received/stored the item.
            // This is a known limitation; read status is not implemented.
            json!({ "ok": true, "itemID": "remote-delivery", "replayID": null, "remote": true })
        } else {
            // No router — local-only mode
            self.local_send_and_remind(args).await
        }
    }

    /// Local store + reminder (used when no router, or as fallback).
    async fn local_send_and_remind(&self, args: &Value) -> Value {
        let result = self.mailbox.send(args).await;
        if result.get("ok").and_then(Value::as_bool) == Some(true) {
            self.send_reminder(args, &result).await;
        }
        result
    }

    /// Unified delivery handler: store item and send reminder to recipient session.
    /// Used by both local `SendMailboxItem` and inbound `kind=deliver` envelopes.
    pub async fn deliver(
        &self,
        args: DeliveryArgs,
        outbound_tx: Option<&mpsc::UnboundedSender<LinkMessage>>,
    ) -> Result<String> {
        // Store the item
        let store_args = json!({
            "runtimeID": args.recipient_runtime_id,
            "sessionID": args.recipient_session_id,
            "ExecutorRuntimeID": args.sender_runtime_id,
            "ExecutorSessionID": args.sender_session_id,
            "senderSessionTitle": args.sender_session_title,
            "title": args.title,
            "msg": args.content,
            "type": args.info_type,
        });
        let result = self.mailbox.send(&store_args).await;
        let item_id = result
            .get("itemID")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        // Send reminder to recipient session
        if result.get("ok").and_then(Value::as_bool) == Some(true) {
            let reminder = build_reminder_from_delivery_with_domain(&args, &item_id, &self.domain);
            let tx = outbound_tx.or(self.outbound_tx.as_ref());
            if let Some(tx) = tx {
                if tx.send(reminder).is_err() {
                    tracing::warn!("failed to send reminder (channel closed)");
                }
            }
        }

        Ok(item_id)
    }

    /// Send a `kind=reminder` envelope to the recipient session.
    async fn send_reminder(&self, args: &Value, result: &Value) {
        let Some(ref tx) = self.outbound_tx else {
            return;
        };
        let reminder = build_reminder_envelope_with_domain(args, result, &self.domain);
        if tx.send(reminder).is_err() {
            tracing::warn!("failed to send reminder envelope (channel closed)");
        }
    }
}

// ── Envelope builders ──────────────────────────────────────────────

/// Build a `kind=deliver` envelope to send mail to a remote mailbox endpoint.
pub(crate) fn build_deliver_envelope(args: &Value) -> LinkMessage {
    build_deliver_envelope_with_domain(args, DEFAULT_MAILBOX_DOMAIN)
}

pub(crate) fn build_deliver_envelope_with_domain(args: &Value, domain: &str) -> LinkMessage {
    let domain = clean_domain(domain);
    let target_runtime = args
        .get("runtimeID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let target_session = args
        .get("sessionID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let content = args.get("msg").and_then(Value::as_str).unwrap_or("");
    let info_type = match args.get("type").and_then(Value::as_str) {
        Some("NeedReplay") => "NeedReplay",
        _ => "Notice",
    };
    let sender_runtime = args
        .get("ExecutorRuntimeID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let sender_session = args
        .get("ExecutorSessionID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    // Target is the mailbox receive address of the target runtime.
    // Convention: <domain>/<target_runtime>/mailbox.
    let envelope = SessionEnvelope {
        id: Uuid::new_v4(),
        source: SessionAddress::new(
            &domain,
            Some(sender_runtime.to_string()),
            Some(sender_session.to_string()),
        ),
        target: SessionAddress::new(
            &domain,
            Some(target_runtime.to_string()),
            Some("mailbox".to_string()), // target's mailbox receive session
        ),
        kind: "control.add_prompt".into(),
        link_type: "control".into(),
        subtype: "add_prompt".into(),
        payload: json!({
            "prompt": {
                "msg": format!("[OSG-Mailbox-Deliver] {}: {}", title, truncate(content, 200)),
                "system": format!("<mailbox>\n<Kind>deliver</Kind>\n<Title>{}</Title>\n</mailbox>", title)
            },
            "mailbox": {
                "kind": "deliver",
                "recipientRuntimeID": target_runtime,
                "recipientSessionID": target_session,
                "senderRuntimeID": sender_runtime,
                "senderSessionID": sender_session,
                "senderSessionTitle": args.get("senderSessionTitle").and_then(Value::as_str).unwrap_or("Unknown"),
                "title": title,
                "content": content,
                "infoType": info_type,
            }
        }),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };

    LinkMessage::Envelope(envelope)
}

/// Build a `kind=reminder` envelope to notify a recipient session about new mail.
pub(crate) fn build_reminder_envelope(args: &Value, result: &Value) -> LinkMessage {
    build_reminder_envelope_with_domain(args, result, DEFAULT_MAILBOX_DOMAIN)
}

pub(crate) fn build_reminder_envelope_with_domain(
    args: &Value,
    result: &Value,
    domain: &str,
) -> LinkMessage {
    let target_runtime = args
        .get("runtimeID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let target_session = args
        .get("sessionID")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let content = args.get("msg").and_then(Value::as_str).unwrap_or("");
    let info_type = match args.get("type").and_then(Value::as_str) {
        Some("NeedReplay") => "NeedReplay",
        _ => "Notice",
    };
    let sender_runtime = args
        .get("ExecutorRuntimeID")
        .and_then(Value::as_str)
        .unwrap_or("mailbox-endpoint");
    let sender_session = args
        .get("ExecutorSessionID")
        .and_then(Value::as_str)
        .unwrap_or("mailbox-endpoint");
    let item_id = result.get("itemID").and_then(Value::as_str).unwrap_or("");

    build_reminder_from_delivery_inner(
        item_id,
        domain,
        target_runtime,
        target_session,
        sender_runtime,
        sender_session,
        title,
        content,
        info_type,
    )
}

/// Build a `kind=reminder` envelope from DeliveryArgs (used by unified handler).
fn build_reminder_from_delivery(args: &DeliveryArgs, item_id: &str) -> LinkMessage {
    build_reminder_from_delivery_with_domain(args, item_id, DEFAULT_MAILBOX_DOMAIN)
}

fn build_reminder_from_delivery_with_domain(
    args: &DeliveryArgs,
    item_id: &str,
    domain: &str,
) -> LinkMessage {
    build_reminder_from_delivery_inner(
        item_id,
        domain,
        &args.recipient_runtime_id,
        &args.recipient_session_id,
        &args.sender_runtime_id,
        &args.sender_session_id,
        &args.title,
        &args.content,
        &args.info_type,
    )
}

/// Inner builder for reminder envelopes.
fn build_reminder_from_delivery_inner(
    item_id: &str,
    domain: &str,
    target_runtime: &str,
    target_session: &str,
    sender_runtime: &str,
    sender_session: &str,
    title: &str,
    content: &str,
    info_type: &str,
) -> LinkMessage {
    let domain = clean_domain(domain);
    let system_prompt = format!(
        "<mailbox>\n<Kind>reminder</Kind>\n<ItemID>{}</ItemID>\n<InfoType>{}</InfoType>\n<Title>{}</Title>\n<SenderRuntimeID>{}</SenderRuntimeID>\n<SenderSessionID>{}</SenderSessionID>\n</mailbox>",
        item_id, info_type, title, sender_runtime, sender_session
    );

    let prompt_msg = format!(
        "[OSG-Mailbox-Reminder] {}: {}",
        title,
        truncate(content, 200)
    );

    let envelope = SessionEnvelope {
        id: Uuid::new_v4(),
        source: SessionAddress::new(
            &domain,
            Some("mailbox-endpoint".to_string()),
            Some("mailbox-endpoint".to_string()),
        ),
        target: SessionAddress::new(
            &domain,
            Some(target_runtime.to_string()),
            Some(target_session.to_string()),
        ),
        kind: "control.add_prompt".into(),
        link_type: "control".into(),
        subtype: "add_prompt".into(),
        payload: json!({
            "sessionID": target_session,
            "msg": prompt_msg,
            "system": system_prompt,
            "prompt": {
                "msg": prompt_msg,
                "system": system_prompt
            },
            "mailbox": {
                "kind": "reminder",
                "itemID": item_id,
                "infoType": info_type,
                "title": title,
                "senderRuntimeID": sender_runtime,
                "senderSessionID": sender_session
            }
        }),
        ttl: 32,
        route_hops: Vec::new(),
        origin_surface: None,
    };

    LinkMessage::Envelope(envelope)
}

// ── Validation & helpers ───────────────────────────────────────────

pub fn mailbox_tool_names() -> &'static [&'static str] {
    &[
        "ListMailboxItems",
        "ReadMailboxItem",
        "SendMailboxItem",
        "ReplyMailboxItem",
        "DeleteMailboxItem",
        "MailboxReminders",
    ]
}

pub fn mailbox_tool_schema(name: &str) -> Option<Value> {
    let executor = json!({ "type": "string", "pattern": "\\S", "description": "Executor/caller mailbox bucket sessionID" });
    let executor_runtime =
        json!({ "type": "string", "description": "Optional executor/caller runtimeID" });
    match name {
        "ListMailboxItems" | "MailboxReminders" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "size": { "type": "number" }, "regex": { "type": "string" }, "metadataRegex": { "type": "string" } },
            "required": ["ExecutorSessionID"], "additionalProperties": true
        })),
        "ReadMailboxItem" | "DeleteMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "itemID": { "type": "string", "pattern": "\\S" } },
            "required": ["ExecutorSessionID", "itemID"], "additionalProperties": true
        })),
        "SendMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "runtimeID": { "type": "string", "pattern": "\\S", "description": "Target runtimeID" }, "sessionID": { "type": "string", "pattern": "\\S", "description": "Target sessionID" }, "title": { "type": "string", "pattern": "\\S" }, "msg": { "type": "string", "pattern": "\\S" }, "type": { "type": "string", "enum": ["Notice", "NeedReplay"] } },
            "required": ["ExecutorSessionID", "runtimeID", "sessionID", "title", "msg"], "additionalProperties": true
        })),
        "ReplyMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "replayID": { "type": "string", "pattern": "\\S" }, "msg": { "type": "string", "pattern": "\\S" } },
            "required": ["ExecutorSessionID", "replayID", "msg"], "additionalProperties": true
        })),
        _ => None,
    }
}

fn validate_args(name: &str, args: &Value) -> Result<()> {
    let required: &[&str] = match name {
        "ListMailboxItems" | "MailboxReminders" => &["ExecutorSessionID"],
        "ReadMailboxItem" | "DeleteMailboxItem" => &["ExecutorSessionID", "itemID"],
        "SendMailboxItem" => &[
            "ExecutorSessionID",
            "runtimeID",
            "sessionID",
            "title",
            "msg",
        ],
        "ReplyMailboxItem" => &["ExecutorSessionID", "replayID", "msg"],
        _ => return Ok(()),
    };
    for key in required {
        if args
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            bail!("{name} requires {key}");
        }
    }
    Ok(())
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

fn clean_domain(domain: impl Into<String>) -> String {
    let clean = domain.into().trim().to_string();
    if clean.is_empty() {
        DEFAULT_MAILBOX_DOMAIN.into()
    } else {
        clean
    }
}
