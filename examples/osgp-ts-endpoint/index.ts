/**
 * Minimal OSGP endpoint in TypeScript — uses the `@opensessiongateway/osgp` SDK.
 *
 * Demonstrates:
 * 1. Hello handshake: `role:"endpoint"`, `capabilities:["surface_viewer"]`
 * 2. Upload `session_update` with no business target (fan-out)
 * 3. Control `add_prompt` with explicit target
 * 4. Request `runtime_session_messages` with explicit target
 * 5. Decoding incoming frames with `decodeOsgpFrame`
 *
 * Uses the standard WebSocket API available in modern Node.js (>=22).
 * No Pingora dependency on endpoint/client side.
 */
import {
  // Types
  type OsgpEnvelope,
  type RouteTarget,
  // Builders
  createHello,
  createUpload,
  createControl,
  createRequest,
  // Codec
  encodeOsgpFrame,
  decodeOsgpFrame,
} from "@opensessiongateway/osgp"

// ── Configuration ───────────────────────────────────────────────────

const routerUrl = process.env.OSGP_ROUTER_URL ?? "ws://127.0.0.1:7200"

const source: RouteTarget = {
  address: { domain: "surface", runtime: "ts-endpoint", session: "demo" },
}

const target: RouteTarget = {
  address: { domain: "domain-a", runtime: "runtime-alpha", session: "session-alpha" },
}

// ── Helpers ─────────────────────────────────────────────────────────

function sendFrame(ws: WebSocket, value: Parameters<typeof encodeOsgpFrame>[0]): void {
  ws.send(encodeOsgpFrame(value))
}

// ── 1. Hello ────────────────────────────────────────────────────────

function sendHello(ws: WebSocket): void {
  const hello = createHello({
    nodeId: "ts-endpoint-demo",
    role: "endpoint",
    addresses: [{ domain: "surface", runtime: "ts-endpoint", session: "demo" }],
    capabilities: ["surface_viewer"],
  })
  sendFrame(ws, hello)
}

// ── 2. Upload: session_update (no business target) ─────────────────

function sendUpload(ws: WebSocket): void {
  const upload = createUpload(
    "session_update",
    source,
    {
      sessionId: "session-alpha",
      state: "running",
      title: "TS OSGP endpoint demo",
    },
  )
  sendFrame(ws, upload)
}

// ── 3. Control: add_prompt (with target) ────────────────────────────

function sendControl(ws: WebSocket): void {
  const control = createControl(
    "add_prompt",
    source,
    target,
    { text: "Hello from a TypeScript OSGP endpoint", role: "user" },
    { ttl: 32 },
  )
  sendFrame(ws, control)
}

// ── 4. Request: runtime_session_messages (with target) ────────────────

function sendRequest(ws: WebSocket): void {
  const request = createRequest(
    "runtime_session_messages",
    source,
    target,
    { sessionId: "session-alpha", limit: 20 },
    { ttl: 32 },
  )
  sendFrame(ws, request)
}

// ── Incoming frame handler ─────────────────────────────────────────

function handleFrame(raw: MessageEvent<string | ArrayBuffer | Blob>): void {
  const text = typeof raw.data === "string" ? raw.data : String(raw.data)
  const decoded = decodeOsgpFrame(text)

  if (decoded.kind === "envelope") {
    const env = decoded.value
    if (env.linkType === "response") {
      console.log("[response]", env.subtype, {
        messageId: env.messageId,
        payload: env.payload,
      })
    } else if (env.linkType === "upload") {
      console.log("[upload]", env.subtype, env.payload)
    } else {
      console.log("[envelope]", env.linkType, env.subtype)
    }
  } else if (decoded.kind === "hello") {
    console.log("[hello]", decoded.value.nodeId, decoded.value.role)
  } else {
    console.log("[unknown frame]", decoded.error)
  }
}

// ── Connect ─────────────────────────────────────────────────────────

const ws = new WebSocket(routerUrl)

ws.addEventListener("open", () => {
  sendHello(ws)
  sendUpload(ws)
  sendControl(ws)
  sendRequest(ws)
  console.log("sent hello + upload + control + request")
})

ws.addEventListener("message", handleFrame)
ws.addEventListener("error", (event) => console.error("WebSocket error", event))
ws.addEventListener("close", (event) => console.log("closed", event.code, event.reason))
