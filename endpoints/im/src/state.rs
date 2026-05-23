mod accounts;
mod chats;
mod events;
mod model;
mod resources;
mod routes;

pub use model::AppState;

use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::provider;

impl AppState {
    pub async fn call_tool(&self, channel: &str, tool: &str, args: Value) -> Result<Value> {
        require_executor(tool, &args)?;
        let mutating = matches!(
            tool,
            "UpsertAccount"
                | "DeleteAccount"
                | "CreateAccountChat"
                | "DeleteAccountChat"
                | "AddAccountChatMembers"
                | "UpsertSessionBinding"
                | "CreateSessionBinding"
                | "DeleteSessionBinding"
                | "UpsertRoute"
                | "DeleteRoute"
                | "SendRouteTextMessage"
                | "RequestUpload"
                | "SendRouteUpload"
                | "RequestDownload"
        );
        let _ = self
            .gv
            .send_tool(channel, tool, args.clone(), mutating)
            .await;
        match (channel, tool) {
            ("control", "GetGatewayInfo") => self.gateway_info().await,
            ("control", "ListProviders") => {
                Ok(json!({"count":2,"items":provider::list_providers()}))
            }
            ("control", "ReloadConfig") => self.reload_config().await,
            ("control", "ListAccounts") => self.list_accounts().await,
            ("control", "UpsertAccount") => self.upsert_account(args).await,
            ("control", "DeleteAccount") => self.delete_account(args).await,
            ("control", "ListAccountChats") => self.list_chats(args).await,
            ("control", "CreateAccountChat") => self.create_chat(args).await,
            ("control", "DeleteAccountChat") => self.delete_chat(args).await,
            ("control", "ListAccountChatMembers") => self.list_members(args).await,
            ("control", "AddAccountChatMembers") => self.add_members(args).await,
            ("control", "ListSessionBindings") => self.list_map("bindings").await,
            ("control", "UpsertSessionBinding") => self.upsert_binding(args, false).await,
            ("control", "CreateSessionBinding") => self.upsert_binding(args, true).await,
            ("control", "DeleteSessionBinding") => self.delete_binding(args).await,
            ("control", "ListRoutes") => self.list_map("routes").await,
            ("control", "GetRoute") => self.get_route(args).await,
            ("control", "UpsertRoute") => self.upsert_route(args).await,
            ("control", "DeleteRoute") => self.delete_route(args).await,
            ("chat", "GetTransferEndpoint") => Ok(
                json!({"requestUploadURL":"/imgw/uploads/{uploadID}","assetURLPrefix":"/imgw/assets/"}),
            ),
            ("chat", "ListRouteMessages") => self.list_messages(args).await,
            ("chat", "SendRouteTextMessage") => self.send_text(args).await,
            ("chat", "RequestUpload") => self.request_upload(args).await,
            ("chat", "SendRouteUpload") => self.send_upload(args).await,
            ("chat", "RequestDownload") => self.request_download(args).await,
            ("chat", "ListRecentRouteEvents") => self.list_events(args).await,
            _ => bail!("unknown IM tool {channel}/{tool}"),
        }
    }
}

fn require_executor(tool: &str, args: &Value) -> Result<()> {
    if !requires_executor(tool) {
        return Ok(());
    }
    let present = args["ExecutorSessionID"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty());
    if present {
        Ok(())
    } else {
        bail!("ExecutorSessionID is required for {tool}; it identifies the caller session and is not target sessionID/sessionBindingID")
    }
}

fn requires_executor(tool: &str) -> bool {
    matches!(
        tool,
        "UpsertAccount"
            | "DeleteAccount"
            | "CreateAccountChat"
            | "DeleteAccountChat"
            | "AddAccountChatMembers"
            | "UpsertSessionBinding"
            | "CreateSessionBinding"
            | "DeleteSessionBinding"
            | "UpsertRoute"
            | "DeleteRoute"
            | "ListRouteMessages"
            | "SendRouteTextMessage"
            | "RequestUpload"
            | "SendRouteUpload"
            | "RequestDownload"
            | "ListRecentRouteEvents"
    )
}
