use anyhow::Result;
use serde_json::{json, Value};

use crate::state::model::*;

impl AppState {
    pub(super) async fn list_events(&self, a: Value) -> Result<Value> {
        let r = str_arg(&a, "routeID")?;
        let items = self
            .inner
            .lock()
            .await
            .events
            .get(r)
            .cloned()
            .unwrap_or_default();
        Ok(json!({"routeID":r,"count":items.len(),"items":items}))
    }
}
