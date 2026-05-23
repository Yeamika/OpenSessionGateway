//! Validation error types and helpers.

use std::fmt;

/// Validation error produced by `validate()` methods.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValidationError {
    EmptyField { field: String },
    FieldMismatch { field: String, reason: String },
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyField { field } => write!(f, "field '{}' must not be empty", field),
            Self::FieldMismatch { field, reason } => {
                write!(f, "field '{}': {}", field, reason)
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
