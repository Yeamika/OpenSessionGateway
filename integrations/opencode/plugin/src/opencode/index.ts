/**
 * opencode module — control command handlers for GlassVein plugin.
 *
 * This module exports all control command handlers and utilities
 * for processing GV control commands in the opencode plugin.
 *
 * Excluded per user decision:
 *   - RequestInstanceWorkspaceReload
 *   - SessionList
 *   - ListAvailableModels
 *   - ShowToast
 */

// Runtime utilities
export { resolveTargetSessionContext, resolveTargetInstanceWorkspaceContext } from "./runtime/target-context.js"
export type { SessionTargetContext } from "./runtime/target-context.js"

export {
  sessionPathOptions,
  sessionMessagesOptions,
  sessionCreateOptions,
  sessionUpdateOptions,
  sessionSummarizeOptions,
  sessionPromptAsyncOptions,
  resultData,
} from "./runtime/session-api.js"

export { instanceWorkspaceFromDirectory, resolveInstanceWorkspaceInfo } from "./runtime/instance-workspace-info.js"
export type { InstanceWorkspaceInfo } from "./runtime/instance-workspace-info.js"

// Control command handlers
export { handleAddPrompt } from "./ws-event/AddPrompt.js"
export { handleAbortSession } from "./ws-event/AbortSession.js"
export { handleCompactSession } from "./ws-event/CompactSession.js"
export { handleCreateNewSession } from "./ws-event/CreateNewSession.js"
export { handleRenameSession } from "./ws-event/RenameSession.js"

export {
  buildPermissionAskedPayload,
  handleResolvePermission,
  buildPermissionResolvedPayload,
} from "./ws-event/Permission.js"

export {
  buildQuestionAskedPayload,
  buildQuestionUpdatedPayload,
  handleReplyQuestionRequest,
  buildQuestionResolvedPayload,
} from "./ws-event/Question.js"

// Server event router
export { handleServerEvent } from "./server-event.js"
export type { ServerEventDeps } from "./server-event.js"

// RequestRuntime (read-only runtime status query)
export { handleRequestRuntime } from "./ws-event/RequestRuntime.js"
export type { RequestRuntimeInput } from "./ws-event/RequestRuntime.js"

// GetSessionMsg
export { handleGetSessionMsg } from "./ws-event/GetSessionMsg.js"
export type { GetSessionMsgItem, GetSessionMsgResponse } from "./ws-event/GetSessionMsg.js"

// ListLastUsedModelOfSession
export { handleListLastUsedModelOfSession } from "./ws-event/ListLastUsedModelOfSession.js"
export type { LastUsedModelOfSessionResponse } from "./ws-event/ListLastUsedModelOfSession.js"

// ListInstanceWorkspaceAvailableAgents
export { handleListInstanceWorkspaceAvailableAgents } from "./ws-event/ListInstanceWorkspaceAvailableAgents.js"
export type { AgentItem, ListInstanceWorkspaceAvailableAgentsResponse } from "./ws-event/ListInstanceWorkspaceAvailableAgents.js"

// Refresh session title
export { refreshSessionTitle } from "./runtime/refresh-session-title.js"

// MCP utilities
export { createMcpServerUrls } from "./runtime/mcp-urls.js"
export {
  applyOsgMcpConfig,
  buildOsgMcpConfig,
  discoverOsgSurfaces,
  readEnabledMcpNames,
  readEnabledMcpMetadata,
} from "./runtime/mcp.js"
export type { LoadedMcpMetadata, OsgMcpSurfaceDescriptor } from "./runtime/mcp.js"
export {
  buildInternalRouterArgs,
  ensureInternalRouter,
  resolveGlassVeinRouterBinary,
  stopInternalRouter,
} from "./runtime/internal-router.js"
export type { InternalRouterStartResult } from "./runtime/internal-router.js"

// Config
export {
  buildVeinRuntimeConfig,
  readVeinConfig,
  readVeinEnvOverrides,
  writeVeinConfig,
  resolveVeinConfigPath,
  readInternalRouterEnvOverrides,
} from "./runtime/config.js"
export type { VeinRuntimeConfig, VeinRuntimeConfigPatch, InternalRouterRuntimeConfig } from "./runtime/config.js"

// Constants
export {
  OSG_TUI_STATUS_EVENT,
  OSG_TUI_CONFIG_SAVE_EVENT,
  OSG_TUI_CONFIG_SAVED_EVENT,
  OSG_TUI_CONFIG_FAILED_EVENT,
} from "./constants.js"

// Query
export { createQuery } from "./query.js"
export type { QueryFactory } from "./query.js"

// Instance client (per-directory, like OSG's OSGOpencodeClient)
export { GvOpencodeInstanceClient } from "./gv-opencode-instance-client.js"

// Session state tracking (standalone, no mapper dependency)
export {
  createSessionStateStore,
  handleSessionStatus,
  handleSessionIdle,
  handleSessionCreated,
  handleSessionDeleted,
  handleSessionError,
  handleSessionCompacted,
  handleMessagePartUpdated,
  handleTuiSessionSelect,
  extractToolExtraInfo,
  extractReasoningExtraInfo,
  type SessionState,
  type SessionReason,
  type SessionStateRow,
  type SessionUpdatePayload,
  type SessionUpdateMetadata,
  type SessionStateStore,
} from "./session-state.js"
