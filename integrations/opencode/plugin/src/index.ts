/**
 * @opensessiongateway/opencode-vein-plugin — GlassVein opencode plugin.
 *
 * Independent npm package for connecting opencode workspaces
 * to the GlassVein Rust router via WebSocket.
 *
 * This replaces the old @opensessiongateway/client-opencode-plugin-v2
 * with GlassVein transport instead of OSG transport.
 */

// ── GlassVein WS client ─────────────────────────────────────────────
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
} from "./glassvein-router/glassvein-ws-client.js"

// ── VeinManager (full plugin manager, replaces OsgManager) ──────────
export {
  VeinManager,
  type ManagerInstance,
  type WriteLog,
} from "./opencode/vein-manager.js"

// ── CurrentClientInfo (session state tracking) ──────────────────────
export {
  createInitialCurrentClientInfo,
  getCurrentClientInfoSnapshot,
  applyEventToCurrentClientInfo,
  type CurrentClientInfo,
} from "./opencode/current-client-info.js"

// ── Types (local, replaces protocol-library dependency) ─────────────
export {
  type ClientSessionState,
  type ClientSessionReason,
  type ClientSessionMeta,
  type ClientContentExecuteingPayload,
} from "./opencode/types.js"

// ── Control command handlers ────────────────────────────────────────
export {
  handleAddPrompt,
  handleAbortSession,
  handleCompactSession,
  handleCreateNewSession,
  handleRenameSession,
  handleResolvePermission,
  handleReplyQuestionRequest,
  handleServerEvent,
  handleRequestRuntime,
  handleGetSessionMsg,
  handleListLastUsedModelOfSession,
  handleListInstanceWorkspaceAvailableAgents,
  resolveTargetSessionContext,
  resolveInstanceWorkspaceInfo,
  sessionPathOptions,
  sessionMessagesOptions,
  sessionCreateOptions,
  sessionUpdateOptions,
  sessionSummarizeOptions,
  sessionPromptAsyncOptions,
  buildPermissionAskedPayload,
  buildPermissionResolvedPayload,
  buildQuestionAskedPayload,
  buildQuestionUpdatedPayload,
  buildQuestionResolvedPayload,
  refreshSessionTitle,
  createMcpServerUrls,
  applyOsgMcpConfig,
  buildOsgMcpConfig,
  discoverOsgSurfaces,
  readEnabledMcpNames,
  readEnabledMcpMetadata,
  buildVeinRuntimeConfig,
  readVeinConfig,
  readVeinEnvOverrides,
  writeVeinConfig,
  resolveVeinConfigPath,
  createQuery,
  OSG_TUI_STATUS_EVENT,
  OSG_TUI_CONFIG_SAVE_EVENT,
  OSG_TUI_CONFIG_SAVED_EVENT,
  OSG_TUI_CONFIG_FAILED_EVENT,
} from "./opencode/index.js"

// ── GvOpencodeInstanceClient (per-directory instance, like OSG's OSGOpencodeClient) ──
export { GvOpencodeInstanceClient } from "./opencode/gv-opencode-instance-client.js"

// ── Types ───────────────────────────────────────────────────────────
export type {
  SessionTargetContext,
  InstanceWorkspaceInfo,
  RequestRuntimeInput,
  GetSessionMsgItem,
  GetSessionMsgResponse,
  LastUsedModelOfSessionResponse,
  AgentItem,
  ListInstanceWorkspaceAvailableAgentsResponse,
  LoadedMcpMetadata,
  OsgMcpSurfaceDescriptor,
  VeinRuntimeConfig,
  VeinRuntimeConfigPatch,
  QueryFactory,
  ServerEventDeps,
} from "./opencode/index.js"

// ── Session state types (standalone, used by GvOpencodeInstanceClient) ──
export {
  type SessionState,
  type SessionReason,
  type SessionStateRow,
  type SessionUpdatePayload,
  type SessionUpdateMetadata,
  extractToolExtraInfo,
  extractReasoningExtraInfo,
} from "./opencode/session-state.js"
