# OSGP TypeScript Endpoint Example

Minimal ordinary WebSocket endpoint for OSGP. It sends:

1. Hello with `role:"endpoint"` and `capabilities:["surface_viewer"]`.
2. `upload/session_update` with no business target.
3. `control/add_prompt` with explicit target and `correlationId`.
4. `request/runtime_session_messages` with explicit target and `requestId`.
5. Logs incoming `response` and `upload` frames.

This example is intentionally outside the root workspace build. Typecheck locally with:

```bash
npm install
npm run typecheck
```
