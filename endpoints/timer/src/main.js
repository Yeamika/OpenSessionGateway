import { createHttpServer } from "./http-server.js";
import { createGvClient } from "./gv-client.js";
import { createTimerService } from "./timer-store.js";
import { loadConfig, parseArgs } from "./config.js";

const args = parseArgs(process.argv.slice(2));
let currentConfig = await loadConfig(args.configPath);
const configManager = {
  get: () => currentConfig,
  async reload() {
    currentConfig = await loadConfig(currentConfig.configPath);
    gv.updateConfig(currentConfig);
    return currentConfig;
  },
};

const gv = createGvClient(currentConfig);
const timers = createTimerService({ onFire: (timer) => gv.sendTimerFired(timer) });
const server = createHttpServer({ configManager, gv, timers });

if (currentConfig.gvRouterUrl) gv.connect();

server.listen(currentConfig.port, currentConfig.host, () => {
  const url = `http://${currentConfig.host}:${currentConfig.port}`;
  console.log(`timer endpoint web: ${url}/`);
  console.log(`timer endpoint MCP manager: ${url}/mcp/timer_manager`);
  console.log(`timer endpoint MCP self: ${url}/mcp/timer_scheduler?runtimeID=${encodeURIComponent(currentConfig.runtimeID)}`);
  if (!currentConfig.gvRouterUrl) console.log("GV router disabled: set routerUrl in config file to connect.");
});
