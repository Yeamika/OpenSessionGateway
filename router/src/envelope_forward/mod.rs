//! Legacy envelope forwarding logic.
//!
//! Handles SessionEnvelope forwarding, typed envelope forwarding,
//! drop handling, and error reply generation.

mod drop;
mod legacy;
#[cfg(test)]
mod tests;
mod typed;

// Re-export public functions
pub use legacy::forward_envelope;
pub use typed::forward_typed_envelope;
