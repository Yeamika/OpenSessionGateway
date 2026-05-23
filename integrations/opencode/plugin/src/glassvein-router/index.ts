/**
 * GlassVein Router integration module.
 *
 * Provides a minimal WS client for connecting an opencode workspace
 * instance to the GlassVein Rust router using the correct wire protocol.
 */

export {
  GlassveinWsClient,
  createGlassveinClient,
  type GlassveinClientConfig,
  type GlassveinClientRole,
  type GlassveinClientState,
  type HelloMessage,
  type LinkMessage,
  type SessionAddress,
  type SessionEnvelope,
  type ControlCommandHandler,
} from "./glassvein-ws-client.js"
