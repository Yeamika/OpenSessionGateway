/**
 * GlassVein Router WS Client — minimal WebSocket client for connecting
 * an opencode workspace instance to the GlassVein Rust router.
 *
 * Uses the @opensessiongateway/osgp SDK for protocol types and the
 * osgp-adapter module for SDK ↔ router wire format bridging.
 *
 * Wire protocol follows OpenSessionGateway Protocol (OSGP):
 *   - Hello: {nodeId, role:"endpoint"|"router", addresses, capabilities}
 *   - LinkMessage: {type: "announce"|"envelope"|..., data: {...}}
 *   - SessionEnvelope business filter: linkType + subtype.
 *   - SessionAddress: {domain, runtime?, session?}  (camelCase)
 */

import WebSocket from "ws"
import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"

// ── OSGP SDK imports ──────────────────────────────────────────────────

import type {
  OsgpType,
  UploadSubtype,
} from "@opensessiongateway/osgp"

// ── Adapter imports (router wire types + converters) ───────────────────

import type {
  RouterSessionAddress,
  RouterSessionEnvelope,
  LinkMessage,
  RouterHelloMessage,
} from "./osgp-adapter.js"

import {
  routerAddressToRouteTarget,
  routerEnvelopeToOsgp,
  createUploadLinkMessage,
  createResponseLinkMessage,
  createRouterHello,
  createAnnounceLinkMessage,
} from "./osgp-adapter.js"

// ── Re-exported types for consumer convenience ────────────────────────

/** Router wire role values — must match OSGP/Rust Role snake_case serialization */
export type GlassveinWireRole = "endpoint" | "router"

/** Client-facing role aliases (maps to wire roles) */
export type GlassveinClientRole = GlassveinWireRole

/** Re-export router address type */
export type SessionAddress = RouterSessionAddress

/** Re-export LinkMessage */
export type { LinkMessage }

/** Re-export router envelope */
export type { RouterSessionEnvelope as SessionEnvelope }

// ── Client-specific types ─────────────────────────────────────────────

export type GlassveinClientConfig = {
  /** WebSocket URL of the GlassVein router (e.g., "ws://127.0.0.1:7240") */
  routerUrl: string
  /** Unique node ID for this client (e.g., "alpha-client") */
  nodeId: string
  /** Network role. User-layer surface semantics must not be encoded here. */
  role?: GlassveinClientRole
  /** Opaque weak capabilities, e.g. ["surface_viewer"] for upload fan-out. */
  capabilities?: string[]
  /** Session address domain (e.g., "domain-a") */
  domain: string
  /** Session address runtime (e.g., "runtime-alpha") */
  runtime?: string
  /** Session address session (e.g., "session-alpha") */
  session?: string
  /** Reconnect interval in ms (default: 3000) */
  reconnectIntervalMs?: number
  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number
}

export type GlassveinClientState = {
  status: "disconnected" | "connecting" | "connected"
  lastError: string
  reconnectAttempt: number
}

/** Hello handshake message (plain struct, not LinkMessage-wrapped) */
export type HelloMessage = RouterHelloMessage

export type ControlCommandHandler = (command: {
  subtype: string
  payload: unknown
  source: RouterSessionAddress
}) => Promise<unknown> | unknown

export type OsgpRequestHandler = (request: {
  id: string
  subtype: string
  source: RouterSessionAddress
  target: RouterSessionAddress
  payload: Record<string, unknown>
}) => Promise<unknown>

export type ReadRequestHandler = OsgpRequestHandler

function readPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

// ── GlassveinWsClient ───────────────────────────────────────────────

export class GlassveinWsClient extends EventEmitter {
  private readonly config: Required<Omit<GlassveinClientConfig, "runtime" | "session">> & Pick<GlassveinClientConfig, "runtime" | "session">
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _state: GlassveinClientState = {
    status: "disconnected",
    lastError: "",
    reconnectAttempt: 0,
  }

  private async handleControlEnvelope(env: RouterSessionEnvelope): Promise<void> {
    const source = env.source
    if (!this.controlCommandHandler) {
      this.sendCanonicalResponse(env, { ok: false, error: "control handler not registered" })
      return
    }
    try {
      const result = await this.controlCommandHandler({ subtype: env.subtype, payload: env.payload, source })
      this.sendCanonicalResponse(env, { ok: true, data: result ?? null })
    } catch (error) {
      this.sendCanonicalResponse(env, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async handleRequestEnvelope(env: RouterSessionEnvelope): Promise<void> {
    const payload = readPayload(env.payload)
    if (!this.requestHandler) {
      this.sendCanonicalResponse(env, { ok: false, error: "request handler not registered" })
      return
    }
    try {
      const data = await this.requestHandler({ id: env.id, subtype: env.subtype, source: env.source, target: env.target, payload })
      this.sendCanonicalResponse(env, { ok: true, data })
    } catch (error) {
      this.sendCanonicalResponse(env, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  private sendCanonicalResponse(env: RouterSessionEnvelope, payload: Record<string, unknown>): boolean {
    return this.sendLinkMessage(createResponseLinkMessage(env.subtype, this.address, env.source, payload, {
      messageId: env.id,
      ttl: 32,
      routeHops: [],
    }))
  }
  private controlCommandHandler: ControlCommandHandler | null = null
  private requestHandler: OsgpRequestHandler | null = null
  private readonly address: RouterSessionAddress

  constructor(config: GlassveinClientConfig) {
    super()
    this.config = {
      routerUrl: config.routerUrl,
      nodeId: config.nodeId,
      role: config.role ?? "endpoint",
      capabilities: config.capabilities ?? [],
      domain: config.domain,
      runtime: config.runtime,
      session: config.session,
      reconnectIntervalMs: config.reconnectIntervalMs ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
    }
    this.address = {
      domain: this.config.domain,
      ...(this.config.runtime ? { runtime: this.config.runtime } : {}),
      ...(this.config.session ? { session: this.config.session } : {}),
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Get current connection state */
  get state(): GlassveinClientState {
    return { ...this._state }
  }

  /** Register a handler for incoming control commands */
  onControlCommand(handler: ControlCommandHandler): void {
    this.controlCommandHandler = handler
  }

  /** Register a handler for incoming canonical OSGP request envelopes */
  onRequest(handler: OsgpRequestHandler): void {
    this.requestHandler = handler
  }

  /** Register a handler for incoming read requests */
  onReadRequest(handler: ReadRequestHandler): void {
    this.requestHandler = handler
  }

  getSourceAddress(): RouterSessionAddress {
    return { ...this.address }
  }

  /** Connect to the GlassVein router */
  async connect(): Promise<void> {
    if (this._state.status === "connected" || this._state.status === "connecting") {
      return
    }
    this._state.status = "connecting"
    this._state.lastError = ""
    this.emit("state", this.state)

    try {
      await this.connectInternal()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this._state.status = "disconnected"
      this._state.lastError = message
      this.emit("state", this.state)
      this.scheduleReconnect()
    }
  }

  /** Disconnect from the router */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this._state.status = "disconnected"
    this._state.lastError = ""
    this._state.reconnectAttempt = 0
    this.emit("state", this.state)

    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect")
      } catch {}
      this.ws = null
    }
  }

  /**
   * Send an upload event with a canonical OSGP subtype.
   *
   * @param subtype - Canonical underscore subtype (e.g., "session_update", "requestion_asked")
   * @param payload - Event payload
   */
  sendUploadEvent(subtype: UploadSubtype, payload: Record<string, unknown>): boolean {
    if (!this.ws || this._state.status !== "connected") {
      return false
    }

    const msg = createUploadLinkMessage(subtype, this.address, payload, {
      ttl: 32,
      routeHops: [],
    })

    return this.sendLinkMessage(msg)
  }

  sendOpencodeEvent(event: { type: string; properties?: Record<string, unknown> }): boolean {
    const subtype = event.type === "session_update"
      ? "session_update" as UploadSubtype
      : event.type.replace(/\./g, "_") as UploadSubtype
    return this.sendUploadEvent(subtype, event.properties || {})
  }

  sendWorkspaceRegister(): boolean {
    return this.sendLinkMessage(createAnnounceLinkMessage(this.address, 0))
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async connectInternal(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.routerUrl)

      const onOpen = async () => {
        ws.removeListener("error", onError)
        this.ws = ws

        try {
          await this.sendHello()
          // Auto-register workspace address with router after Hello
          this.sendWorkspaceRegister()
          this._state.status = "connected"
          this._state.lastError = ""
          this._state.reconnectAttempt = 0
          this.emit("state", this.state)
          this.emit("connected")
          resolve()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this._state.status = "disconnected"
          this._state.lastError = message
          this.emit("state", this.state)
          reject(error)
        }
      }

      const onError = (error: Error) => {
        ws.removeListener("open", onOpen)
        reject(error)
      }

      ws.once("open", onOpen)
      ws.once("error", onError)

      ws.on("message", (data) => {
        this.handleMessage(data)
      })

      ws.on("close", (code, reason) => {
        this.ws = null
        const reasonText = typeof reason === "string" ? reason : reason?.toString() || ""
        this._state.status = "disconnected"
        this._state.lastError = `closed: ${code} ${reasonText}`.trim()
        this.emit("state", this.state)
        this.emit("disconnected", { code, reason: reasonText })
        this.scheduleReconnect()
      })

      ws.on("error", (error) => {
        if (this.ws === ws) {
          this._state.lastError = error.message
          this.emit("error", error)
        }
      })
    })
  }

  private async sendHello(): Promise<void> {
    const hello = createRouterHello(
      this.config.nodeId,
      this.config.role as "endpoint" | "router",
      [this.address],
      this.config.capabilities,
    )
    const text = JSON.stringify(hello)
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("not connected"))
      this.ws.send(text, (error) => {
        if (error) reject(error)
        else {
          this.emit("hello_sent", hello)
          resolve()
        }
      })
    })
  }

  private sendLinkMessage(msg: LinkMessage): boolean {
    if (!this.ws || this._state.status !== "connected") {
      return false
    }
    try {
      const text = JSON.stringify(msg)
      this.ws.send(text)
      return true
    } catch {
      return false
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const text = typeof data === "string" ? data : data.toString()
      const msg = JSON.parse(text) as LinkMessage

      if (msg.type === "envelope" && "id" in msg) {
        const env = msg as unknown as RouterSessionEnvelope
        if (env.linkType === "control") {
          void this.handleControlEnvelope(env)
          this.emit("control_command", env)
        } else if (env.linkType === "request") {
          void this.handleRequestEnvelope(env)
          this.emit("request", env)
        } else {
          this.emit("message", msg)
        }
      } else if (msg.type === "ping") {
        this.sendLinkMessage({ type: "pong" })
      } else if (msg.type === "pong") {
        this.emit("pong")
      } else if (msg.type === "announce") {
        this.emit("announce", { address: msg.address, distance: msg.distance })
      } else {
        this.emit("message", msg)
      }
    } catch (error) {
      this.emit("error", error)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this._state.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.emit("reconnect_failed", { attempt: this._state.reconnectAttempt })
      return
    }

    this._state.reconnectAttempt++
    const delay = Math.min(
      this.config.reconnectIntervalMs * Math.pow(1.5, this._state.reconnectAttempt - 1),
      30000,
    )

    this.emit("reconnect_scheduled", {
      attempt: this._state.reconnectAttempt,
      delayMs: delay,
    })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectInternal().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this._state.lastError = message
        this.emit("state", this.state)
        this.scheduleReconnect()
      })
    }, delay)
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createGlassveinClient(
  ctx: { directory?: string },
  config: Pick<GlassveinClientConfig, "routerUrl"> & Partial<Omit<GlassveinClientConfig, "routerUrl">>,
): GlassveinWsClient {
  const directory = typeof ctx.directory === "string" ? ctx.directory.trim() : ""
  const nodeId = config.nodeId || directory.split(/[\\/]/).filter(Boolean).pop() || "unknown-workspace"
  const domain = config.domain || "domain-a"
  const runtime = config.runtime || nodeId
  const session = config.session || undefined

  return new GlassveinWsClient({
    routerUrl: config.routerUrl,
    nodeId,
    role: config.role || "endpoint",
    capabilities: config.capabilities,
    domain,
    runtime,
    session,
    reconnectIntervalMs: config.reconnectIntervalMs,
    maxReconnectAttempts: config.maxReconnectAttempts,
  })
}
