import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

if (!parentPort) {
  throw new Error("plugin worker requires parentPort");
}

const state = {
  manifest: null,
  source: {
    kind: "file",
    requestedPath: typeof workerData?.requestedPath === "string" ? workerData.requestedPath : "",
    absolutePath: typeof workerData?.absolutePath === "string" ? workerData.absolutePath : "",
  },
  surfaces: new Map(),
  cleanups: [],
  pendingHostCalls: new Map(),
  nextHostRequestID: 0,
  nextSessionStatusSubscriptionID: 0,
  pendingOperations: new Set(),
  subscriptions: {
    runtime_connect: new Set(),
    runtime_disconnect: new Set(),
    ws_event: new Set(),
    session_status_change: new Map(),
  },
  activationGate: null,
  deactivating: false,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

state.activationGate = deferred();

function post(message) {
  parentPort.postMessage(message);
}

function log(level, message, extra) {
  post({ type: "log", level, message, ...(extra ? { extra } : {}) });
}

function normalizeManifest(value) {
  const id = typeof value?.id === "string" ? value.id.trim() : "";
  const version = typeof value?.version === "string" ? value.version.trim() : "";
  if (!id) throw new Error("plugin manifest.id is required");
  if (!version) throw new Error(`plugin ${id} manifest.version is required`);
  return {
    id,
    version,
    name: typeof value?.name === "string" ? value.name.trim() : undefined,
    description: typeof value?.description === "string" ? value.description.trim() : undefined,
  };
}

function asPluginDefinition(value) {
  if (!value || typeof value !== "object") {
    throw new Error("plugin module must export an object");
  }
  if (!value.manifest || typeof value.activate !== "function") {
    throw new Error("plugin module must export { manifest, activate }");
  }
  return value;
}

async function loadPluginDefinition(absolutePath) {
  const loaded = await import(pathToFileURL(absolutePath).href);
  const candidate = typeof loaded.createPlugin === "function"
    ? await loaded.createPlugin()
    : loaded.default ?? loaded.plugin ?? loaded;
  return asPluginDefinition(candidate);
}

function trackOperation(promise) {
  state.pendingOperations.add(promise);
  promise.finally(() => {
    state.pendingOperations.delete(promise);
  });
  return promise;
}

async function waitForPendingOperations() {
  while (state.pendingOperations.size > 0) {
    await Promise.all([...state.pendingOperations]);
  }
}

function callHost(action, payload) {
  state.nextHostRequestID += 1;
  const requestID = state.nextHostRequestID;
  const pending = deferred();
  state.pendingHostCalls.set(requestID, pending);
  post({
    type: "host_request",
    requestID,
    action,
    payload,
  });
  return pending.promise;
}

function createStorageApi() {
  return {
    async get(key) {
      return callHost("storage_get", { key: typeof key === "string" ? key : "" });
    },
    async set(key, value) {
      return callHost("storage_set", { key: typeof key === "string" ? key : "", value });
    },
    async delete(key) {
      return callHost("storage_delete", { key: typeof key === "string" ? key : "" });
    },
    async list(prefix = "") {
      return callHost("storage_list", { prefix: typeof prefix === "string" ? prefix : "" });
    },
  };
}

function createOsgApi() {
  return {
    async listRuntimeClients() {
      return callHost("osg_list_runtime_clients", {});
    },
    async requireOnlineRuntime(runtimeID) {
      await callHost("osg_require_online_runtime", { runtimeID });
    },
    async listRuntimeManagedSessions(runtimeID) {
      return callHost("osg_list_runtime_managed_sessions", { runtimeID });
    },
    async listRuntimeWorkspaces(runtimeID) {
      return callHost("osg_list_runtime_workspaces", { runtimeID });
    },
    async requestRuntime(payload) {
      return callHost("osg_request_runtime", payload && typeof payload === "object" ? payload : {});
    },
    async requestSessionList(payload) {
      return callHost("osg_request_session_list", payload && typeof payload === "object" ? payload : {});
    },
    async createNewSession(payload) {
      return callHost("osg_create_new_session", payload && typeof payload === "object" ? payload : {});
    },
    async renameClientSession(payload) {
      return callHost("osg_rename_client_session", payload && typeof payload === "object" ? payload : {});
    },
    async setClientDisplaySession(payload) {
      return callHost("osg_set_client_display_session", payload && typeof payload === "object" ? payload : {});
    },
    async abortClientSession(payload) {
      return callHost("osg_abort_client_session", payload && typeof payload === "object" ? payload : {});
    },
    async listAvailableModels(payload) {
      return callHost("osg_list_available_models", payload && typeof payload === "object" ? payload : {});
    },
    async getSessionLastUsedModel(payload) {
      return callHost("osg_get_session_last_used_model", payload && typeof payload === "object" ? payload : {});
    },
    async reloadClientInstanceWorkspace(payload) {
      return callHost("osg_reload_client_instance_workspace", payload && typeof payload === "object" ? payload : {});
    },
    async hasOnlineRuntime(runtimeID) {
      return callHost("osg_has_online_runtime", { runtimeID });
    },
    async hasOnlineRuntimeSession(runtimeID, sessionID) {
      return callHost("osg_has_online_runtime_session", { runtimeID, sessionID });
    },
    async requireOnlineRuntimeSession(runtimeID, sessionID) {
      await callHost("osg_require_online_runtime_session", { runtimeID, sessionID });
    },
    async addPrompt(payload) {
      return callHost("osg_add_prompt", payload && typeof payload === "object" ? payload : {});
    },
    async getSessionMessages(payload) {
      return callHost("osg_get_session_messages", payload && typeof payload === "object" ? payload : {});
    },
    async showToast(payload) {
      await callHost("osg_show_toast", payload && typeof payload === "object" ? payload : {});
    },
    async bindCallerToRuntime(callerKey, runtimeID) {
      await callHost("osg_bind_caller_to_runtime", { callerKey, runtimeID });
    },
    async resolveRuntimeByCaller(callerKey) {
      return callHost("osg_resolve_runtime_by_caller", { callerKey });
    },
  };
}

function normalizeSurfaceInfo(surface, routeSegment) {
  const info = typeof surface.info === "function" ? surface.info() : null;
  if (!info || typeof info !== "object") {
    throw new Error(`surface.info() must return an object: ${routeSegment}`);
  }
  return info;
}

function normalizeHookName(hook) {
  if (hook === "runtime_connect" || hook === "runtime_disconnect" || hook === "ws_event" || hook === "session_status_change") {
    return hook;
  }
  throw new Error(`unknown hook: ${String(hook || "")}`);
}

function normalizeSessionStatusTarget(target) {
  const runtimeID = typeof target?.runtimeID === "string" ? target.runtimeID.trim() : "";
  const sessionID = typeof target?.sessionID === "string" ? target.sessionID.trim() : "";
  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  return { runtimeID, sessionID };
}

function normalizeSessionStatusOptions(options) {
  return {
    emitCurrent: options?.emitCurrent === true,
  };
}

function registerSurface(surface) {
  if (!surface || typeof surface !== "object") {
    throw new Error("surface is required");
  }

  const routeSegment = typeof surface.routeSegment === "string" ? surface.routeSegment.trim() : "";
  if (!routeSegment) {
    throw new Error("surface.routeSegment is required");
  }

  state.surfaces.set(routeSegment, surface);
  const payload = {
    id: typeof surface.id === "string" && surface.id.trim()
      ? surface.id.trim()
      : `${state.manifest.id}.surface.${state.surfaces.size}`,
    routeSegment,
    info: normalizeSurfaceInfo(surface, routeSegment),
  };
  trackOperation(callHost("register_surface", payload));
}

function createHookRegistrar(hook) {
  return (listener) => {
    if (typeof listener !== "function") {
      throw new Error(`hook listener must be a function: ${hook}`);
    }

    const set = state.subscriptions[hook];
    set.add(listener);
    if (set.size === 1) {
      trackOperation(callHost("subscribe_hook", { hook }));
    }

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      set.delete(listener);
      if (set.size === 0) {
        trackOperation(callHost("unsubscribe_hook", { hook })).catch((error) => {
          log("warn", error instanceof Error ? error.message : String(error));
        });
      }
    };
  };
}

function createSessionStatusHookRegistrar() {
  return (target, optionsOrListener, maybeListener) => {
    const listener = typeof optionsOrListener === "function" ? optionsOrListener : maybeListener;
    if (typeof listener !== "function") {
      throw new Error("session status hook listener must be a function");
    }

    const normalizedTarget = normalizeSessionStatusTarget(target);
    const normalizedOptions = typeof optionsOrListener === "function"
      ? { emitCurrent: false }
      : normalizeSessionStatusOptions(optionsOrListener);

    state.nextSessionStatusSubscriptionID += 1;
    const subscriptionID = `session_status_change:${state.nextSessionStatusSubscriptionID}`;
    state.subscriptions.session_status_change.set(subscriptionID, {
      listener,
      target: normalizedTarget,
      options: normalizedOptions,
    });
    trackOperation(callHost("subscribe_hook", {
      hook: "session_status_change",
      subscriptionID,
      target: normalizedTarget,
      options: normalizedOptions,
    }));

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      state.subscriptions.session_status_change.delete(subscriptionID);
      trackOperation(callHost("unsubscribe_hook", {
        hook: "session_status_change",
        subscriptionID,
      })).catch((error) => {
        log("warn", error instanceof Error ? error.message : String(error));
      });
    };
  };
}

function createContext() {
  return {
    pluginID: state.manifest.id,
    manifest: state.manifest,
    source: state.source,
    cleanup(fn) {
      if (typeof fn !== "function") {
        throw new Error("cleanup must be a function");
      }
      state.cleanups.push(fn);
    },
    log,
    mcp: {
      registerSurface,
    },
    osg: createOsgApi(),
    storage: createStorageApi(),
    hooks: {
      onRuntimeConnect: createHookRegistrar("runtime_connect"),
      onRuntimeDisconnect: createHookRegistrar("runtime_disconnect"),
      onWsEvent: createHookRegistrar("ws_event"),
      onSessionStatusChange: createSessionStatusHookRegistrar(),
    },
  };
}

function createRequestLike(snapshot) {
  const method = typeof snapshot?.method === "string" ? snapshot.method : "POST";
  const urlText = typeof snapshot?.url === "string" ? snapshot.url : "http://127.0.0.1/";
  const url = new URL(urlText);
  return {
    method,
    url: url.href,
    headers: new Headers(snapshot?.headers && typeof snapshot.headers === "object" ? snapshot.headers : {}),
    nextUrl: url,
  };
}

function responseInitFromObject(value) {
  const status = Number(value?.status);
  const headers = value?.headers && typeof value.headers === "object" ? value.headers : {};
  return {
    status: Number.isInteger(status) && status >= 100 ? status : 200,
    headers,
  };
}

async function toResponse(value) {
  if (value instanceof Response) {
    return value;
  }

  if (value && typeof value === "object" && ("body" in value || "status" in value || "headers" in value)) {
    const body = typeof value.body === "string"
      ? value.body
      : value.body === undefined || value.body === null
        ? ""
        : JSON.stringify(value.body);
    return new Response(body, responseInitFromObject(value));
  }

  return Response.json(value);
}

async function serializeResponse(value) {
  const response = await toResponse(value);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

async function handleRpcCall(message) {
  const routeSegment = typeof message.routeSegment === "string" ? message.routeSegment.trim() : "";
  const rpcID = Number(message.rpcID);
  if (!routeSegment || !Number.isInteger(rpcID)) {
    return;
  }

  const surface = state.surfaces.get(routeSegment);
  if (!surface || typeof surface.handleRpc !== "function") {
    post({
      type: "rpc_error",
      rpcID,
      error: `unknown worker surface: ${routeSegment}`,
    });
    return;
  }

  try {
    const response = await surface.handleRpc(message.body, createRequestLike(message.request));
    post({
      type: "rpc_result",
      rpcID,
      response: await serializeResponse(response),
    });
  } catch (error) {
    post({
      type: "rpc_error",
      rpcID,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleForwardedEvent(message) {
  const hook = normalizeHookName(message.hook);
  if (hook === "session_status_change") {
    const subscriptionID = typeof message.payload?.subscriptionID === "string" ? message.payload.subscriptionID : "";
    const subscription = state.subscriptions.session_status_change.get(subscriptionID);
    if (!subscription) return;
    try {
      await subscription.listener(message.payload?.event);
    } catch (error) {
      log("error", error instanceof Error ? error.message : String(error));
    }
    return;
  }
  const listeners = [...state.subscriptions[hook]];
  for (const listener of listeners) {
    try {
      await listener(message.payload);
    } catch (error) {
      log("error", error instanceof Error ? error.message : String(error));
    }
  }
}

async function deactivateWorker() {
  if (state.deactivating) return;
  state.deactivating = true;

  const cleanupList = [...state.cleanups].reverse();
  state.cleanups.length = 0;
  for (const cleanup of cleanupList) {
    try {
      await cleanup();
    } catch (error) {
      log("error", error instanceof Error ? error.message : String(error));
    }
  }

  state.subscriptions.runtime_connect.clear();
  state.subscriptions.runtime_disconnect.clear();
  state.subscriptions.ws_event.clear();
  state.subscriptions.session_status_change.clear();
  post({ type: "deactivated" });
}

parentPort.on("message", async (message) => {
  try {
    if (message?.type === "activate_ack") {
      if (message.ok) {
        state.activationGate.resolve();
      } else {
        state.activationGate.reject(new Error(typeof message.error === "string" ? message.error : "activation rejected"));
      }
      return;
    }

    if (message?.type === "host_reply") {
      const pending = state.pendingHostCalls.get(message.requestID);
      if (!pending) return;
      state.pendingHostCalls.delete(message.requestID);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(typeof message.error === "string" ? message.error : "host operation failed"));
      }
      return;
    }

    if (message?.type === "rpc_call") {
      await handleRpcCall(message);
      return;
    }

    if (message?.type === "event") {
      await handleForwardedEvent(message);
      return;
    }

    if (message?.type === "deactivate") {
      await deactivateWorker();
    }
  } catch (error) {
    log("error", error instanceof Error ? error.message : String(error));
  }
});

(async () => {
  try {
    const plugin = await loadPluginDefinition(state.source.absolutePath);
    state.manifest = normalizeManifest(plugin.manifest);
    post({ type: "loaded", manifest: state.manifest });
    await state.activationGate.promise;

    const context = createContext();
    const result = await plugin.activate(context);
    if (typeof result === "function") {
      state.cleanups.push(result);
    }
    await waitForPendingOperations();
    post({ type: "activated" });
  } catch (error) {
    post({
      type: "activation_failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
