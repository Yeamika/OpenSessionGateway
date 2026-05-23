//! Deprecated business broadcast module.
//!
//! Router no longer performs user-layer observer/control/requestion broadcast.
//! Upload fan-out is implemented as local delivery to generic endpoint peers
//! that self-declare the opaque `surface_viewer` capability.

/// Business broadcast-by-kind is no longer supported.
pub fn is_broadcast_event(_kind: &str) -> bool {
    false
}
