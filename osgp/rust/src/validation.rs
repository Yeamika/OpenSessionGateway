//! Validation error types and helpers.

use std::fmt;

/// Validation error produced by `validate()` methods.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValidationError {
    EmptyField { field: String },
    FieldMismatch { field: String, reason: String },
    /// Subtype not in the canonical registry for the given link type.
    UnknownSubtype { link_type: String, subtype: String },
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyField { field } => write!(f, "field '{}' must not be empty", field),
            Self::FieldMismatch { field, reason } => {
                write!(f, "field '{}': {}", field, reason)
            }
            Self::UnknownSubtype { link_type, subtype } => {
                write!(
                    f,
                    "unknown subtype '{}' for link type '{}' (not in canonical registry)",
                    subtype, link_type
                )
            }
        }
    }
}

impl std::error::Error for ValidationError {}

/// Check that a string value is non-empty after trimming.
pub(crate) fn validate_non_empty(field: &str, value: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        Err(ValidationError::EmptyField {
            field: field.into(),
        })
    } else {
        Ok(())
    }
}
