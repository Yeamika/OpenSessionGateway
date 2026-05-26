const $ = (id) => document.getElementById(id);
const stateEls = {
  status: $("status"), error: $("error"), summary: $("summary"),
  updates: $("updates"), logs: $("logs"),
};

$("connect").addEventListener("click", () => post("/api/connect", readConfig()));
$("disconnect").addEventListener("click", () => post("/api/disconnect", {}));
document.querySelectorAll("[data-request]").forEach((button) => {
  button.addEventListener("click", () => post("/api/request", requestBody(button.dataset.request)));
});
document.querySelectorAll("[data-control]").forEach((button) => {
  button.addEventListener("click", () => post("/api/control", controlBody(button.dataset.control)));
});

setInterval(refresh, 1500);
refresh();

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(value.error || "request failed");
  await refresh();
}

async function refresh() {
  try {
    const state = await fetch("/api/state").then((response) => response.json());
    render(state);
  } catch (error) {
    stateEls.error.textContent = String(error.message || error);
  }
}

function readConfig() {
  return {
    router_url: $("routerUrl").value.trim(),
    node_id: $("nodeId").value.trim(),
    source: address("source"),
    target: address("target"),
  };
}

function requestBody(subtype) {
  return { subtype, payload: clean({ sessionId: $("targetSession").value.trim(), limit: Number($("limit").value) || 50 }) };
}

function controlBody(subtype) {
  const sessionId = $("targetSession").value.trim();
  const title = $("title").value.trim();
  const text = $("prompt").value.trim();
  const payload = { sessionId };
  if (subtype === "add_prompt") Object.assign(payload, { role: "user", text });
  if (subtype === "rename_session") Object.assign(payload, { title, newName: title });
  if (subtype === "create_session") Object.assign(payload, { title });
  return { subtype, payload: clean(payload) };
}

function address(prefix) {
  return clean({
    domain: $(`${prefix}Domain`).value.trim(),
    runtime: $(`${prefix}Runtime`).value.trim(),
    session: $(`${prefix}Session`).value.trim(),
  });
}

function render(state) {
  stateEls.status.textContent = state.status;
  stateEls.status.className = state.status === "connected" ? "connected" : "";
  stateEls.error.textContent = state.last_error || "";
  stateEls.summary.textContent = JSON.stringify(state.summary || {}, null, 2);
  renderList(stateEls.updates, state.updates || []);
  renderList(stateEls.logs, state.logs || []);
}

function renderList(container, items) {
  container.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const time = new Date(Number(item.at_ms)).toLocaleTimeString();
    li.innerHTML = `<time>${time}</time><strong></strong><pre></pre>`;
    li.querySelector("strong").textContent = item.label;
    li.querySelector("pre").textContent = JSON.stringify(item.payload, null, 2);
    return li;
  }));
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== undefined));
}
