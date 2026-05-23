import { timerId } from "./state.js";

export function bindUi(handlers) {
  const elements = {
    configForm: document.querySelector("#configForm"),
    timerForm: document.querySelector("#timerForm"),
    refreshButton: document.querySelector("#refreshButton"),
    statusText: document.querySelector("#statusText"),
    errorBox: document.querySelector("#errorBox"),
    timerList: document.querySelector("#timerList"),
    wirePreview: document.querySelector("#wirePreview"),
  };
  elements.configForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.saveConfig(readConfig(elements.configForm));
  });
  elements.timerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.createTimer(readTimer(elements.timerForm));
  });
  elements.refreshButton.addEventListener("click", handlers.refresh);
  elements.timerList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-timer]");
    if (button) handlers.deleteTimer(button.dataset.timer);
  });
  return elements;
}

export function applyConfig(form, state) {
  form.elements.runtimeID.value = state.runtimeID || "";
  form.elements.sessionID.value = state.sessionID || "";
  form.elements.listAll.checked = Boolean(state.listAll);
}

export function render(elements, state) {
  elements.statusText.textContent = state.busy ? "Working…" : state.status;
  elements.errorBox.hidden = !state.error;
  elements.errorBox.textContent = state.error;
  elements.wirePreview.textContent = state.envelope ? JSON.stringify(state.envelope, null, 2) : "No request yet.";
  for (const button of document.querySelectorAll("button")) button.disabled = state.busy;
  renderTimers(elements.timerList, state.timers);
}

function renderTimers(container, timers) {
  container.replaceChildren();
  if (!timers.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "No timers.";
    container.append(empty);
    return;
  }
  for (const timer of timers) container.append(timerCard(timer));
}

function timerCard(timer) {
  const card = document.createElement("article");
  card.className = "timer-card";
  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = timer.Title || timerId(timer);
  const msg = document.createElement("p");
  msg.textContent = timer.MSG || "";
  const meta = document.createElement("div");
  meta.className = "timer-meta";
  [timer.TimerType, timer.status, timerId(timer), timer.RuntimeID, timer.SessionID, timer.triggerAt]
    .filter(Boolean).forEach((text) => meta.append(pill(text)));
  body.append(title, msg, meta);
  const button = document.createElement("button");
  button.className = "danger";
  button.type = "button";
  button.dataset.timer = timerId(timer);
  button.textContent = "Delete";
  card.append(body, button);
  return card;
}

function pill(text) {
  const span = document.createElement("span");
  span.className = "pill";
  span.textContent = text;
  return span;
}

function readConfig(form) {
  return {
    runtimeID: form.elements.runtimeID.value.trim(),
    sessionID: form.elements.sessionID.value.trim(),
    listAll: form.elements.listAll.checked,
  };
}

function readTimer(form) {
  return {
    timerType: form.elements.timerType.value,
    title: form.elements.title.value.trim(),
    msg: form.elements.msg.value.trim(),
    afterSeconds: Number(form.elements.afterSeconds.value),
    everySeconds: Number(form.elements.everySeconds.value),
    cronExpr: form.elements.cronExpr.value.trim(),
  };
}
