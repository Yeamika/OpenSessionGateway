import fs from "node:fs/promises";

import { loadConfig } from "./src/config.ts";
import { GatewayProviderRegistry } from "./src/provider.ts";
import { StateStore } from "./src/state.ts";

async function main() {
  const config = loadConfig();
  const registry = new GatewayProviderRegistry();
  const stateStore = new StateStore(config.stateFilePath);

  await fs.mkdir(config.uploadDir, { recursive: true });
  await stateStore.ensure();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    plugin: "im-gateway",
    host: config.host,
    port: config.port,
    routePrefix: config.routePrefix,
    stateFilePath: config.stateFilePath,
    uploadDir: config.uploadDir,
    providers: registry.listProviders(),
  }, null, 2)}\n`);
}

void main().catch((error) => {
  console.error("[im-gateway probe] failed", error);
  process.exitCode = 1;
});
