const KEY = "gv.timer.endpoint.web";

export function loadUiState(defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

export function saveUiState(state) {
  localStorage.setItem(KEY, JSON.stringify({
    runtimeID: state.runtimeID,
    sessionID: state.sessionID,
    listAll: state.listAll,
  }));
}

export function createStore(initial) {
  let state = { ...initial, timers: [], status: "Idle", error: "", busy: false, envelope: null };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

export function timerId(timer) {
  return timer?.TimerID || "";
}
