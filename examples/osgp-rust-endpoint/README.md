# OSGP Rust Endpoint Example

Minimal ordinary WebSocket endpoint for OSGP.

- Endpoint side does **not** require Pingora.
- This docs/example uses sync `tungstenite` for compactness.
- For production async services, choose the WS client crate that matches your runtime (for example `fastwebsockets` + hyper). Do not treat `tokio-tungstenite` as the recommended production dependency.

Run locally, outside the root workspace:

```bash
cargo run --manifest-path examples/osgp-rust-endpoint/Cargo.toml
```

Set a router URL if needed:

```bash
OSGP_ROUTER_URL=ws://127.0.0.1:7200 cargo run --manifest-path examples/osgp-rust-endpoint/Cargo.toml
```
