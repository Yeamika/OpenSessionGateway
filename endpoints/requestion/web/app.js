const list = document.querySelector("#requestions")
const log = document.querySelector("#log")
const template = document.querySelector("#card-template")
document.querySelector("#refresh").addEventListener("click", refresh)

refresh()
setInterval(refresh, 3000)

async function refresh() {
  try {
    const response = await fetch("/api/requestions")
    const data = await response.json()
    render(data.requestions || [])
  } catch (error) {
    addLog(error.message || String(error))
  }
}

function render(items) {
  list.replaceChildren()
  if (items.length === 0) {
    const empty = document.createElement("p")
    empty.className = "empty"
    empty.textContent = "No pending requestions in endpoint cache."
    list.append(empty)
    return
  }
  for (const item of items) list.append(card(item))
}

function card(item) {
  const node = template.content.firstElementChild.cloneNode(true)
  node.querySelector(".title").textContent = item.title || item.request_id
  node.querySelector(".meta").textContent = `${formatAddress(item.source)} • ${item.session_id} • ${item.request_id}`
  node.querySelector(".payload").textContent = JSON.stringify(item.payload, null, 2)
  node.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault()
    const submitter = event.submitter
    const form = new FormData(event.currentTarget)
    await respond(item, submitter?.value || "response", String(form.get("response") || ""))
  })
  return node
}

async function respond(item, decision, responseText) {
  const response = await fetch("/api/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: item.session_id,
      requestId: item.request_id,
      decision,
      response: responseText,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || "response failed")
  addLog(`queued requestion_respond for ${item.request_id}`)
  await refresh()
}

function addLog(message) {
  const item = document.createElement("li")
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`
  log.prepend(item)
}

function formatAddress(address) {
  if (!address) return "unknown"
  return [address.domain, address.runtime, address.session].filter(Boolean).join("/")
}
