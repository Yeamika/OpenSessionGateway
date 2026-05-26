const $ = (id) => document.getElementById(id);
const stateEl = $("state");
const itemsEl = $("items");
const errorEl = $("error");

$("send").addEventListener("click", async () => {
  await post("/api/mailbox/send", {
    ExecutorRuntimeID: $("callerRuntime").value.trim(),
    ExecutorSessionID: $("callerSession").value.trim(),
    runtimeID: $("targetRuntime").value.trim(),
    sessionID: $("targetSession").value.trim(),
    title: $("title").value.trim(),
    msg: $("msg").value.trim(),
    type: $("type").value,
  });
  await listTarget();
});
$("list").addEventListener("click", listTarget);
setInterval(refresh, 1500);
refresh();

async function listTarget() {
  const value = await post("/api/mailbox/list", {
    ExecutorRuntimeID: $("targetRuntime").value.trim(),
    ExecutorSessionID: $("targetSession").value.trim(),
    size: 20,
  });
  renderItems(value.list || []);
}

async function post(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(clean(body)) });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(value.error || value.message || "request failed");
  errorEl.textContent = "";
  return value;
}

async function refresh() {
  try {
    const state = await fetch("/api/status").then((response) => response.json());
    $("status").textContent = state.status;
    stateEl.textContent = JSON.stringify(state, null, 2);
  } catch (error) {
    errorEl.textContent = String(error.message || error);
  }
}

function renderItems(items) {
  itemsEl.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong></strong><time></time><pre></pre>`;
    li.querySelector("strong").textContent = `${item.title} [${item.InfoType}]`;
    li.querySelector("time").textContent = new Date(Number(item.times)).toLocaleString();
    li.querySelector("pre").textContent = JSON.stringify(item, null, 2);
    return li;
  }));
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== undefined));
}
