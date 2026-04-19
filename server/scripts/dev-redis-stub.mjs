import net from "node:net";

const port = Number(process.env.PORT || 6380);
const host = process.env.HOST || "127.0.0.1";

function bulk(text) {
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

function parseArrayCommand(source, offset = 0) {
  if (source[offset] !== "*") return null;
  const countEnd = source.indexOf("\r\n", offset);
  if (countEnd < 0) return null;
  const count = Number(source.slice(offset + 1, countEnd));
  if (!Number.isInteger(count) || count < 0) return null;
  let cursor = countEnd + 2;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    if (source[cursor] !== "$") return null;
    const lenEnd = source.indexOf("\r\n", cursor);
    if (lenEnd < 0) return null;
    const len = Number(source.slice(cursor + 1, lenEnd));
    if (!Number.isInteger(len) || len < 0) return null;
    const valueStart = lenEnd + 2;
    const valueEnd = valueStart + len;
    if (valueEnd + 2 > source.length) return null;
    items.push(source.slice(valueStart, valueEnd));
    cursor = valueEnd + 2;
  }
  return { items, next: cursor };
}

function repliesFor(items) {
  const command = String(items[0] || "").trim().toUpperCase();
  if (command === "PING") return "+PONG\r\n";
  if (command === "INFO") return bulk("# Server\r\nredis_version:7.2.0\r\n");
  if (command === "HELLO") return `%2\r\n+server\r\n+redis\r\n+version\r\n+7.2.0\r\n`;
  if (command === "CLIENT") return "+OK\r\n";
  if (command === "SELECT") return "+OK\r\n";
  if (command === "QUIT") return "+OK\r\n";
  if (command === "LPUSH") return ":1\r\n";
  if (command === "LTRIM") return "+OK\r\n";
  if (command === "LRANGE") return "*0\r\n";
  return "+OK\r\n";
}

const server = net.createServer((socket) => {
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.length > 0) {
      const parsed = parseArrayCommand(buffer, 0);
      if (!parsed) {
        if (!buffer.includes("\r\n")) break;
        const lineEnd = buffer.indexOf("\r\n");
        const inline = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 2);
        if (!inline) continue;
        socket.write(repliesFor(inline.split(/\s+/g)));
        continue;
      }

      buffer = buffer.slice(parsed.next);
      socket.write(repliesFor(parsed.items));
      if (String(parsed.items[0] || "").trim().toUpperCase() === "QUIT") {
        socket.end();
        break;
      }
    }
  });
});

server.listen(port, host, () => {
  process.stdout.write(`[dev-redis-stub] listening on ${host}:${port}\n`);
});
