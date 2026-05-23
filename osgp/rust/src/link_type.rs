//! Link type discriminator.

use serde::{Deserialize, Serialize};

/// Canonical OSGP type discriminator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkType {
    Upload,
    Control,
    Request,
    Response,
}

impl LinkType {
    pub fn as_wire(&self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Control => "control",
            Self::Request => "request",
            Self::Response => "response",
        }
    }
}
