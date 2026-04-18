const webOrigin = process.env.OSG_WEB_ORIGIN?.trim() || "http://127.0.0.1:4089";
const adminPort = process.env.OSG_ADMIN_PORT?.trim() || "4091";
const adminUrl = `http://127.0.0.1:${adminPort}/`;

export default function GatewayPage() {
  return (
    <main className="gateway-shell">
      <section className="gateway-card">
        <p className="gateway-eyebrow">OpenSessionGateway</p>
        <h1>Gateway</h1>
        <p className="gateway-copy">
          The interactive monitor UI now lives in <code>web/</code>. This app keeps the gateway APIs, WebSocket runtime port,
          MCP surfaces, and local plugin admin server.
        </p>
        <div className="gateway-links">
          <a href={webOrigin}>Open web UI</a>
          <a href="/api/health">Health API</a>
          <a href="/api/monitor/stream">Monitor stream</a>
          <a href={adminUrl}>Plugin admin</a>
        </div>
      </section>
    </main>
  );
}
