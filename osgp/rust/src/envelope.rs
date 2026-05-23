//! Envelope types: SessionEnvelope (compat), Envelope (canonical), LinkMessage.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::address::{RouteTarget, SessionAddress};
use crate::link_type::LinkType;
use crate::payload::Payload;
use crate::read::{ReadRequest, ReadResponse};
use crate::validation::{validate_non_empty, ValidationError};

// ── SessionEnvelope (compat: legacy `kind` + canonical linkType/subtype) ───

/// Legacy envelope carried over the wire.
///
/// Fields use `camelCase` serialization matching the OSGP protocol.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnvelope {
    pub id: Uuid,
    pub source: SessionAddress,
    pub target: SessionAddress,
    /// Legacy `kind` field kept for backward compatibility.
    /// Canonical routing uses `link_type` + `subtype` instead.
    pub kind: String,
    /// Canonical type (`"upload"`, `"control"`, `"request"`, `"response"`).
    pub link_type: String,
    /// Canonical business filter subtype.
    pub subtype: String,
    /// Payload — remains for non-business envelope labels and
    /// backward compatibility.
    pub payload: Value,
    pub ttl: u8,
    #[serde(default)]
    pub route_hops: Vec<String>,
    pub origin_surface: Option<String>,
}

impl SessionEnvelope {
    pub fn new(
        source: SessionAddress,
        target: SessionAddress,
        kind: impl Into<String>,
        payload: Value,
    ) -> Self {
        let kind = kind.into();
        let (link_type, subtype) = canonical_type_subtype(&kind, &payload);
        Self {
            id: Uuid::new_v4(),
            source,
            target,
            kind,
            link_type,
            subtype,
            payload,
            ttl: 32,
            route_hops: Vec::new(),
            origin_surface: None,
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_non_empty("type", &self.link_type)?;
        validate_non_empty("subtype", &self.subtype)?;
        Ok(())
    }
}

/// Derive canonical `(link_type, subtype)` from a compat `kind` + payload.
///
/// Maps legacy dotted kinds to canonical `linkType`/`subtype`:
/// - `control.X` → `("control", X or payload.subtype)`
/// - `requestion.X` → `("upload", "requestion_X")`
/// - `session_update` → `("upload", "session_update")`
/// - everything else → pass-through (preserves raw kind)
pub(crate) fn canonical_type_subtype(kind: &str, payload: &Value) -> (String, String) {
    if kind.starts_with("control.") {
        let subtype = payload
            .get("subtype")
            .and_then(|v| v.as_str())
            .unwrap_or(kind.strip_prefix("control.").unwrap_or(kind));
        ("control".into(), subtype.into())
    } else if kind.starts_with("requestion.") {
        let subtype = kind.strip_prefix("requestion.").unwrap_or(kind);
        ("upload".into(), format!("requestion_{subtype}"))
    } else {
        match kind {
            "session_update" => ("upload".into(), "session_update".into()),
            _ => (kind.into(), kind.into()),
        }
    }
}

// ── Envelope (canonical typed) ───────────────────────────────────────

/// Typed envelope with `RouteTarget` source/target and structured payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub message_id: String,
    pub source: RouteTarget,
    pub target: RouteTarget,
    pub payload: Payload,
    pub link_type: LinkType,
    pub subtype: String,
    #[serde(default)]
    pub route_hops: Vec<String>,
}

impl Envelope {
    pub fn new(source: RouteTarget, target: RouteTarget, payload: Payload) -> Self {
        Self {
            message_id: Uuid::new_v4().to_string(),
            source,
            target,
            link_type: payload.link_type(),
            subtype: payload.subtype(),
            payload,
            route_hops: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        self.source.validate()?;
        self.target.validate()?;
        self.payload.validate()?;
        if self.link_type != self.payload.link_type() {
            return Err(ValidationError::FieldMismatch {
                field: "link_type".into(),
                reason: format!(
                    "envelope: {:?} vs payload: {:?}",
                    self.link_type,
                    self.payload.link_type()
                ),
            });
        }
        if self.subtype != self.payload.subtype() {
            return Err(ValidationError::FieldMismatch {
                field: "subtype".into(),
                reason: "does not match payload subtype".to_string(),
            });
        }
        Ok(())
    }
}

// ── LinkMessage ──────────────────────────────────────────────────────

/// Top-level wire message exchanged between nodes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LinkMessage {
    Announce {
        address: SessionAddress,
        distance: u32,
    },
    Envelope(SessionEnvelope),
    TypedEnvelope(Envelope),
    ReadRequest(ReadRequest),
    ReadResponse(ReadResponse),
    Ping,
    Pong,
}
