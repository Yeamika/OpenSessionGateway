import { callTimerTool, createArgs, deleteArgs, listArgs, loadStatus } from "./api.js";
import { createStore, loadUiState, saveUiState, timerId } from "./state.js";
import { applyConfig, bindUi, render } from "./ui.js";

const status = await loadStatus();
const store = createStore(loadUiState({
  runtimeID: status.config.runtimeID,
  sessionID: status.config.sessionID,
  listAll: false,
}));

const elements = bindUi({ saveConfig, createTimer, refresh, deleteTimer });
applyConfig(elements.configForm, store.get());
store.subscribe((state) => render(elements, state));
refresh();

function saveConfig(config) {
  store.set({ ...config, status: "Settings saved.", error: "" });
  saveUiState(store.get());
  refresh();
}

async function createTimer(input) {
  await run("Creating timer…", async () => {
    const request = createArgs(store.get(), input);
    const response = await callTimerTool(request.tool, request.args);
    store.set({ envelope: response.envelope });
    await refresh();
    return "Timer created.";
  });
}

async function refresh() {
  await run("Refreshing timers…", async () => {
    const request = listArgs(store.get());
    const response = await callTimerTool(request.tool, request.args);
    const list = response.result?.list || [];
    store.set({ timers: list, envelope: response.envelope });
    return `Loaded ${list.length} timer(s).`;
  });
}

async function deleteTimer(id) {
  await run("Deleting timer…", async () => {
    const timer = store.get().timers.find((row) => timerId(row) === id);
    const request = deleteArgs(store.get(), timer || { TimerID: id });
    const response = await callTimerTool(request.tool, request.args);
    store.set({ envelope: response.envelope });
    await refresh();
    return "Timer deleted.";
  });
}

async function run(status, action) {
  store.set({ busy: true, status, error: "" });
  try {
    const nextStatus = await action();
    store.set({ busy: false, status: nextStatus || "Done.", error: "" });
  } catch (error) {
    store.set({ busy: false, status: "Action failed.", error: error instanceof Error ? error.message : String(error) });
  }
}
