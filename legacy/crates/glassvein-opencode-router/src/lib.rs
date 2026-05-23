//! GlassVein OpenCode Router — message schema definitions.
//!
//! Defines the wire protocol between TS WS clients and the Rust router.

use serde::{Deserialize, Serialize};

/// Unique identifier for a workspace connection.
pub type WorkspaceId = String;

/// Unique identifier for a message.
pub type MessageId = String;

/// Unique identifier for a request correlation.
pub type CorrelationId = String;

/// Messages from TS client to Rust router.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Initial handshake: client announces itself.
    Hello {
        /// Workspace identifier (e.g., path hash or name).
        workspace_id: WorkspaceId,
        /// Client version.
        version: Option<String>,
    },

    /// Register workspace with metadata.
    WorkspaceRegister {
        /// Workspace identifier.
        workspace_id: WorkspaceId,
        /// Workspace root path.
        root_path: String,
        /// Optional metadata.
        metadata: Option<serde_json::Value>,
    },

    /// Forward an opencode event from TS plugin.
    OpenCodeEvent {
        /// Event type (e.g., "session.created", "file.changed").
        event_type: String,
        /// Event payload.
        payload: serde_json::Value,
        /// Optional correlation ID for request/response.
        correlation_id: Option<CorrelationId>,
    },

    /// Control command from client.
    ControlCommand {
        /// Command type (e.g., "abort", "compact", "restart").
        command: String,
        /// Command arguments.
        args: Option<serde_json::Value>,
        /// Correlation ID for response.
        correlation_id: Option<CorrelationId>,
    },

    /// Ping for keepalive.
    Ping,
}

/// Messages from Rust router to TS client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Hello response with assigned session info.
    HelloAck {
        /// Assigned session ID by router.
        session_id: String,
        /// Router version.
        router_version: String,
        /// Token for this session (for reconnection).
        token: String,
    },

    /// Workspace registration acknowledgment.
    WorkspaceRegisterAck {
        /// Workspace ID that was registered.
        workspace_id: WorkspaceId,
        /// Success status.
        success: bool,
    },

    /// Generic acknowledgment.
    Ack {
        /// Correlation ID of the original request.
        correlation_id: CorrelationId,
        /// Success status.
        success: bool,
        /// Optional message.
        message: Option<String>,
    },

    /// Error response.
    Error {
        /// Correlation ID if available.
        correlation_id: Option<CorrelationId>,
        /// Error code.
        code: ErrorCode,
        /// Human-readable error message.
        message: String,
    },

    /// Forward an opencode event to client (from another workspace or router).
    OpenCodeEvent {
        /// Source workspace ID.
        source_workspace_id: WorkspaceId,
        /// Event type.
        event_type: String,
        /// Event payload.
        payload: serde_json::Value,
        /// Optional correlation ID.
        correlation_id: Option<CorrelationId>,
    },

    /// Control command forwarded to client.
    ControlCommand {
        /// Command type.
        command: String,
        /// Command arguments.
        args: Option<serde_json::Value>,
        /// Correlation ID.
        correlation_id: Option<CorrelationId>,
    },

    /// Pong response to Ping.
    Pong,
}

/// Error codes for protocol errors.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// Invalid message format.
    InvalidMessage,
    /// Not authenticated.
    Unauthorized,
    /// Workspace not found.
    WorkspaceNotFound,
    /// Internal router error.
    InternalError,
    /// Rate limited.
    RateLimited,
    /// Unsupported operation.
    Unsupported,
}

/// Readiness info printed to stdout when router is ready.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadinessInfo {
    /// Port the TS WS server is listening on.
    pub port: u16,
    /// Port the GV wire listener is listening on.
    pub gv_port: u16,
    /// Authentication token for connections.
    pub token: String,
    /// Process ID.
    pub pid: u32,
    /// WebSocket URL for TS clients.
    pub ws_url: String,
    /// WebSocket URL for GV wire connections (surface/router).
    pub gv_ws_url: String,
}

// ── GV Wire Protocol Types ─────────────────────────────────────────

/// Network-layer role of a peer connecting via OSGP/GV wire protocol.
/// User-layer surface meaning is carried by message type/subtype and optional
/// opaque capabilities, not by router roles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WireRole {
    /// Generic user-layer endpoint/client/service/surface.
    Endpoint,
    /// Another router.
    Router,
}

/// Hello message for GV wire protocol handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GvHelloMessage {
    /// Node identifier of the sender.
    pub node_id: String,
    /// Role of the sender.
    pub role: WireRole,
    /// Addresses this node can route to (for route learning).
    #[serde(default)]
    pub addresses: Vec<osgp::SessionAddress>,
    /// Opaque weak endpoint capabilities, e.g. `surface_viewer` for local
    /// upload fan-out. Router must not infer user-layer roles from this.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// Tap event emitted when the router processes an opencode event.
///
/// Delivered to observer-surface peers for local visibility.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TapEvent {
    /// An opencode event was received from a TS workspace client.
    OpenCodeEvent {
        /// Source workspace ID.
        workspace_id: WorkspaceId,
        /// Event type.
        event_type: String,
        /// Event payload.
        payload: serde_json::Value,
        /// Timestamp (unix millis).
        timestamp: u64,
    },
    /// A control command was forwarded to a TS workspace client.
    ControlCommand {
        /// Source surface ID.
        surface_id: String,
        /// Target workspace ID.
        workspace_id: WorkspaceId,
        /// Command type.
        command: String,
        /// Timestamp (unix millis).
        timestamp: u64,
    },
    /// A TS workspace client connected.
    ClientConnect {
        /// Workspace ID.
        workspace_id: WorkspaceId,
        /// Timestamp (unix millis).
        timestamp: u64,
    },
    /// A TS workspace client disconnected.
    ClientDisconnect {
        /// Workspace ID.
        workspace_id: WorkspaceId,
        /// Timestamp (unix millis).
        timestamp: u64,
    },
}

/// Helper to get current timestamp in milliseconds.
pub fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
