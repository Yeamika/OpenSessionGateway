use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::state::model::*;

impl AppState {
    pub async fn write_upload(
        &self,
        upload_id: &str,
        file_name: &str,
        mime: &str,
        bytes: &[u8],
    ) -> Result<Value> {
        let mut m = self.inner.lock().await;
        let upload = m
            .uploads
            .get_mut(upload_id)
            .ok_or_else(|| anyhow::anyhow!("upload not found: {upload_id}"))?;
        upload["fileName"] = json!(file_name);
        upload["mimeType"] = json!(mime);
        upload["byteLength"] = json!(bytes.len());
        upload["contentText"] = json!(String::from_utf8_lossy(bytes).to_string());
        upload["status"] = json!("ready");
        Ok(upload.clone())
    }
    pub async fn read_asset(&self, asset_id: &str) -> Result<(String, Vec<u8>)> {
        let m = self.inner.lock().await;
        let asset = m
            .assets
            .get(asset_id)
            .ok_or_else(|| anyhow::anyhow!("asset not found: {asset_id}"))?;
        Ok((
            asset["mimeType"]
                .as_str()
                .unwrap_or("application/octet-stream")
                .into(),
            asset["contentText"]
                .as_str()
                .unwrap_or("")
                .as_bytes()
                .to_vec(),
        ))
    }
    pub(super) async fn list_messages(&self, a: Value) -> Result<Value> {
        let r = str_arg(&a, "routeID")?;
        // Canonical OSGP: request / runtime_session_messages
        let session_id = a["sessionID"].as_str().unwrap_or("session");
        let limit = a["limit"].as_u64().map(|v| v as u32);
        let _ = self
            .gv
            .send_read_messages(session_id, limit, None)
            .await;
        let items = self
            .inner
            .lock()
            .await
            .messages
            .get(r)
            .cloned()
            .unwrap_or_default();
        Ok(json!({"routeID":r,"count":items.len(),"items":items}))
    }
    pub(super) async fn send_text(&self, a: Value) -> Result<Value> {
        let route = self.route(str_arg(&a, "routeID")?).await?;
        let text = str_arg(&a, "text")?;
        let mut msg = message(&route, "text", text, "", "");
        msg["executor"] = executor_audit(&a);
        self.push_message(&route["routeID"].as_str().unwrap_or(""), msg.clone())
            .await;
        // Canonical OSGP: control / add_prompt — forward IM message to target runtime
        let system = format!(
            "<IMGateway routeID={} provider={} accountID={} chatID={}>",
            route["routeID"].as_str().unwrap_or(""),
            route["provider"].as_str().unwrap_or(""),
            route["accountID"].as_str().unwrap_or(""),
            route["chatID"].as_str().unwrap_or(""),
        );
        let _ = self.gv.send_add_prompt(text, Some(&system), None).await;
        Ok(msg)
    }
    pub(super) async fn request_upload(&self, a: Value) -> Result<Value> {
        let id = format!("up_{}", now_ms());
        let item = json!({"uploadID":id,"routeID":s(&a,"routeID"),"type":s_or(&a,"type","file"),"status":"pending","fileName":"","mimeType":"","byteLength":0,"contentText":"","executor":executor_audit(&a)});
        self.inner.lock().await.uploads.insert(id.clone(), item);
        Ok(
            json!({"uploadID":id,"routeID":s(&a,"routeID"),"type":s_or(&a,"type","file"),"method":"POST","uploadURL":format!("/imgw/uploads/{id}")}),
        )
    }
    pub(super) async fn send_upload(&self, a: Value) -> Result<Value> {
        let route = self.route(str_arg(&a, "routeID")?).await?;
        let upload_id = str_arg(&a, "uploadID")?;
        let mut m = self.inner.lock().await;
        let up = m
            .uploads
            .get_mut(upload_id)
            .ok_or_else(|| anyhow::anyhow!("upload not found: {upload_id}"))?;
        if up["status"].as_str() == Some("pending") {
            up["status"] = json!("ready");
            up["contentText"] = json!(format!("generated content for {upload_id}"));
        }
        let up_type = up["type"].as_str().unwrap_or("file").to_string();
        let res_key = format!("res_{}", upload_id);
        let msg = message(&route, &up_type, &res_key, &up_type, &res_key);
        m.messages
            .entry(route["routeID"].as_str().unwrap_or("").into())
            .or_default()
            .insert(0, msg.clone());
        drop(m);
        // Canonical OSGP: control / add_prompt — forward upload notification to target runtime
        let system = format!(
            "<IMGatewayUpload routeID={} uploadID={} type={}>",
            route["routeID"].as_str().unwrap_or(""),
            upload_id,
            up_type,
        );
        let preview = format!("[Uploaded {}]", up_type);
        let _ = self.gv.send_add_prompt(&preview, Some(&system), None).await;
        Ok(
            json!({"routeID":route["routeID"],"uploadID":upload_id,"messageID":msg["messageID"],"msgType":msg["msgType"]}),
        )
    }
    pub(super) async fn request_download(&self, a: Value) -> Result<Value> {
        let route_id = str_arg(&a, "routeID")?;
        let message_id = str_arg(&a, "messageID")?;
        let typ = str_arg(&a, "type")?;
        let mut m = self.inner.lock().await;
        let msg = m
            .messages
            .get(route_id)
            .and_then(|v| {
                v.iter()
                    .find(|x| x["messageID"].as_str() == Some(message_id))
            })
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("message not found: {message_id}"))?;
        if msg["resourceType"].as_str().unwrap_or("") != typ {
            bail!("message resource type mismatch");
        }
        let id = format!("ast_{}", now_ms());
        m.assets.insert(id.clone(), json!({"assetID":id,"routeID":route_id,"messageID":message_id,"type":typ,"mimeType":"text/plain","contentText":msg["content"]}));
        Ok(
            json!({"assetID":id,"routeID":route_id,"type":typ,"downloadURL":format!("/imgw/assets/{id}")}),
        )
    }
    async fn push_message(&self, route_id: &str, msg: Value) {
        let mut m = self.inner.lock().await;
        m.messages
            .entry(route_id.into())
            .or_default()
            .insert(0, msg.clone());
        m.events.entry(route_id.into()).or_default().insert(0, json!({"routeID":route_id,"messageID":msg["messageID"],"preview":msg["preview"],"receivedAt":now_ms().to_string()}));
    }
}
