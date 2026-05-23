//! ClientRoute transport trait and address helpers.

use anyhow::Result;
use async_trait::async_trait;
use osgp::LinkMessage;

/// Router connection abstraction used by client-side code.
#[async_trait]
pub trait ClientRouteTransport: Send + Sync {
    async fn send_link(&self, message: LinkMessage) -> Result<()>;
    async fn recv_link(&self) -> Result<Option<LinkMessage>>;
}

// ─────────────────────── Address key helpers ────────────────────────

/// Compute a stable string key from a `SessionAddress`.
pub(crate) fn address_key(addr: &osgp::SessionAddress) -> String {
    format!(
        "{}/{}/{}",
        addr.domain,
        addr.runtime.as_deref().unwrap_or("*"),
        addr.session.as_deref().unwrap_or("*"),
    )
}

/// Best-effort parse of an address key back into a `SessionAddress`.
pub(crate) fn parse_address_key(key: &str) -> Option<osgp::SessionAddress> {
    let parts: Vec<&str> = key.splitn(3, '/').collect();
    if parts.len() != 3 {
        return None;
    }
    Some(osgp::SessionAddress::new(
        parts[0],
        if parts[1] == "*" {
            None
        } else {
            Some(parts[1].to_string())
        },
        if parts[2] == "*" {
            None
        } else {
            Some(parts[2].to_string())
        },
    ))
}
