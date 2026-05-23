export function createStore(initialConfig) {
  const state = {
    config: initialConfig,
    gatewayInfo: null,
    providers: [],
    accounts: [],
    chats: [],
    members: [],
    bindings: [],
    routes: [],
    messages: [],
    activeRouteID: "",
    uploadInfo: null,
    log: [],
  };
  const listeners = new Set();

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(update) {
      Object.assign(state, update);
      for (const listener of listeners) listener(state);
    },
    log(message, level = "info") {
      state.log = [{ time: new Date().toLocaleTimeString(), level, message }, ...state.log].slice(0, 80);
      for (const listener of listeners) listener(state);
    },
  };
}

export function itemsOf(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.providers)) return result.providers;
  return [];
}

export function selectedRoute(state) {
  return state.routes.find((route) => route.routeID === state.activeRouteID) || null;
}
