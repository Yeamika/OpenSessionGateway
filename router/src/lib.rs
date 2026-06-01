//! GlassVein router runtime.
//!
//! Router wires transports and neighbors around `core`; routing decisions remain
//! in `core`, while concrete listener/server code should stay adapter-oriented.
//!
//! ## Architecture
//!
//! - **Downstream peers**: generic endpoints or routers that connect here
//! - **Upstream**: parent router this node connects to (0 or 1 in tree topology)
//! - **RouteTable** (in `core`): owns forwarding decisions
//! - **TapEvent**: optional internal debug/observability stream; not a user-layer
//!   observer delivery mechanism.
//!
//! ## Module structure
//!
//! - `admin`: Admin plane handler for route/rule management
//! - `config`: Router configuration
//! - `node`: Router node main structure and lifecycle
//! - `connection`: WebSocket connection management (listener, upstream, peer registry)
//! - `tap`: Internal debug tap event types
//! - `transport`: Peer handles, roles, and Hello handshake types
//! - `envelope_forward`: Legacy envelope forwarding, drop handling, error replies
//! - `read_forward`: Cross-domain read request/response forwarding

pub mod admin;
pub mod config;
pub mod connection;
pub mod envelope_forward;
pub mod node;
pub mod operator_shell;
pub mod read_forward;
pub mod state_store;
mod tap;
mod transport;

pub use admin::{AdminHandler, AdminRequest, AdminResponse};
pub use config::{ListenerBackend, RouterConfig};
pub use connection::{ConnectionManager, ListenerConfig, UpstreamConfig};
pub use node::RouterNode;
pub use operator_shell::{parse_command, ShellCommand, ShellOutput, HELP_TEXT};
pub use state_store::{StateStore, RouterState, SerializedRule};
pub use tap::{EnvelopeSummary, TapEvent};
#[allow(deprecated)]
pub use osgp::{HelloMessage, Role};
pub use transport::{PeerHandle, PeerRole, UpstreamHandle};

use osgp::SessionAddress;

// ── Helpers ─────────────────────────────────────────────────────────

/// Format a SessionAddress for display.
pub fn format_address(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

/// Parse a slash-delimited address string into a SessionAddress.
/// Format: "domain" or "domain/runtime" or "domain/runtime/session".
/// Wildcards: "*" in runtime or session position becomes None.
pub fn format_address_parse(s: &str) -> SessionAddress {
    let parts: Vec<&str> = s.split('/').collect();
    let runtime = parts.get(1).and_then(|r| if *r == "*" { None } else { Some(r.to_string()) });
    let session = parts.get(2).and_then(|s| if *s == "*" { None } else { Some(s.to_string()) });
    SessionAddress::new(parts[0], runtime, session)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use osgp::{ReadOperation, SessionId};

    #[test]
    fn read_operation_op_names() {
        // Canonical four: op_name must return the canonical wire name.
        assert_eq!(
            ReadOperation::RuntimeSessionMessages {
                runtime_id: "rt1".into(),
                session_id: SessionId::new("s1"),
                anchor_time: None,
                limit: None,
                regex: None,
            }
            .op_name(),
            "runtimeSessionMessages"
        );
        assert_eq!(
            ReadOperation::RuntimeRequestionSnapshot {
                runtime_id: "rt1".into(),
                session_id: Some(SessionId::new("s1")),
                status: None,
                blocking: false,
            }
            .op_name(),
            "runtimeRequestionSnapshot"
        );
        assert_eq!(
            ReadOperation::RuntimeWorkspaceViewSnapshot {
                runtime_id: "rt1".into(),
                workspace: None,
            }
            .op_name(),
            "runtimeWorkspaceViewSnapshot"
        );
        assert_eq!(
            ReadOperation::RuntimeSessionViewSnapshot {
                runtime_id: "rt1".into(),
                session_id: SessionId::new("s1"),
                requestion_status: None,
            }
            .op_name(),
            "runtimeSessionViewSnapshot"
        );
    }
}
