import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

type Parsed = {
  command: string;
  options: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Parsed {
  const options: Record<string, string | boolean> = {};
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }

    const key = token.slice(2).trim();
    if (!key) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }

  return {
    command: (rest[0] || "run").toLowerCase(),
    options,
  };
}

function optionString(options: Record<string, string | boolean>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

function usage() {
  process.stdout.write(
    [
      "client-template CLI",
      "",
      "Commands:",
      "  run|start         Start template runtime client",
      "  test|smoke        Run automated OSG smoke test",
       "  script|replay     Run TESTJSON scenario runner",
       "  control           Start stdin-json control server",
       "  fleet             Start many client-template runtimes for visualization tests",
      "",
      "Common options:",
      "  --base-url <url>       OSG base URL (default: http://127.0.0.1:4088/api/v2)",
      "  --runtime-id <id>      Fixed runtimeID",
      "",
      "Run options:",
      "  --host-name <name>     Runtime host name (default: client-template)",
      "",
      "Test options:",
      "  --connect-timeout-ms <n>",
      "  --retry-ms <n>",
      "  --retry-count <n>",
      "  --test-json-file <path>",
      "  --test-json <json>",
      "  --test-json-mode <append|replace>",
      "  --json                 Emit smoke events as JSON lines",
      "",
      "Control mode:",
      "  stdin: one JSON object per line, output is JSON lines",
      "  command example:",
      "    {\"id\":1,\"op\":\"createNewSession\",\"args\":{\"directory\":\"${cwd}\",\"content\":\"hello\"}}",
      "",
      "Fleet options:",
      "  --runtime-count <n>",
      "  --workspace-count <n>",
      "  --sessions-per-workspace <n>",
      "  --base-dir <path>",
      "  --runtime-prefix <name>",
      "  --workspace-prefix <name>",
      "  --host-prefix <name>",
      "  --connect-timeout-ms <n>",
      "",
      "Examples:",
      "  npm run cli -w @opensessiongateway/client-template -- run --base-url http://127.0.0.1:4088/api/v2",
      "  npm run cli -w @opensessiongateway/client-template -- test --json",
      "  npm run cli -w @opensessiongateway/client-template -- script --test-json-file scenarios/basic-tools.json --json",
      "  npm run cli -w @opensessiongateway/client-template -- control --runtime-id run_debug_1",
      "  npm run cli -w @opensessiongateway/client-template -- fleet --runtime-count 4 --workspace-count 3 --sessions-per-workspace 5",
      "",
    ].join("\n"),
  );
}

function runNode(scriptFileName: string, env: Record<string, string>) {
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), scriptFileName);
  const child = spawn(process.execPath, [scriptPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function run() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const baseUrl = optionString(options, "base-url");
  const runtimeID = optionString(options, "runtime-id");

  if (command === "run" || command === "start") {
    const hostName = optionString(options, "host-name");
    runNode("index.js", {
      ...(baseUrl ? { OSG_BASE_URL: baseUrl } : {}),
      ...(runtimeID ? { OSG_RUNTIME_ID: runtimeID } : {}),
      ...(hostName ? { OSG_HOST_NAME: hostName } : {}),
    });
    return;
  }

  if (command === "test" || command === "smoke") {
    const connectTimeout = optionString(options, "connect-timeout-ms");
    const retryMs = optionString(options, "retry-ms");
    const retryCount = optionString(options, "retry-count");
    const testJson = optionString(options, "test-json");
    const testJsonFile = optionString(options, "test-json-file");
    const testJsonMode = optionString(options, "test-json-mode");
    const json = options.json === true;

    runNode("osg-smoke-test.js", {
      ...(baseUrl ? { OSG_BASE_URL: baseUrl } : {}),
      ...(runtimeID ? { OSG_TEST_RUNTIME_ID: runtimeID } : {}),
      ...(connectTimeout ? { OSG_TEST_CONNECT_TIMEOUT_MS: connectTimeout } : {}),
      ...(retryMs ? { OSG_TEST_RETRY_MS: retryMs } : {}),
      ...(retryCount ? { OSG_TEST_RETRY_COUNT: retryCount } : {}),
      ...(testJson ? { OSG_TEST_JSON: testJson } : {}),
      ...(testJsonFile ? { OSG_TEST_JSON_FILE: testJsonFile } : {}),
      ...(testJsonMode ? { OSG_TEST_JSON_MODE: testJsonMode } : {}),
      ...(json ? { OSG_SMOKE_JSON: "1" } : {}),
    });
    return;
  }

  if (command === "script" || command === "replay") {
    const testJson = optionString(options, "test-json");
    const testJsonFile = optionString(options, "test-json-file");
    const testJsonMode = optionString(options, "test-json-mode") || "replace";
    const json = options.json === true;

    runNode("osg-smoke-test.js", {
      ...(baseUrl ? { OSG_BASE_URL: baseUrl } : {}),
      ...(runtimeID ? { OSG_TEST_RUNTIME_ID: runtimeID } : {}),
      ...(testJson ? { OSG_TEST_JSON: testJson } : {}),
      ...(testJsonFile ? { OSG_TEST_JSON_FILE: testJsonFile } : {}),
      OSG_TEST_JSON_MODE: testJsonMode,
      ...(json ? { OSG_SMOKE_JSON: "1" } : {}),
    });
    return;
  }

  if (command === "control") {
    const hostName = optionString(options, "host-name");
    runNode("script-control.js", {
      ...(baseUrl ? { OSG_BASE_URL: baseUrl } : {}),
      ...(runtimeID ? { OSG_RUNTIME_ID: runtimeID } : {}),
      ...(hostName ? { OSG_HOST_NAME: hostName } : {}),
    });
    return;
  }

  if (command === "fleet") {
    const runtimeCount = optionString(options, "runtime-count");
    const workspaceCount = optionString(options, "workspace-count");
    const sessionsPerWorkspace = optionString(options, "sessions-per-workspace");
    const baseDir = optionString(options, "base-dir");
    const runtimePrefix = optionString(options, "runtime-prefix");
    const workspacePrefix = optionString(options, "workspace-prefix");
    const hostPrefix = optionString(options, "host-prefix");
    const connectTimeout = optionString(options, "connect-timeout-ms");

    runNode("fleet.js", {
      ...(baseUrl ? { OSG_BASE_URL: baseUrl } : {}),
      ...(runtimeCount ? { OSG_FLEET_RUNTIME_COUNT: runtimeCount } : {}),
      ...(workspaceCount ? { OSG_FLEET_WORKSPACE_COUNT: workspaceCount } : {}),
      ...(sessionsPerWorkspace ? { OSG_FLEET_SESSIONS_PER_WORKSPACE: sessionsPerWorkspace } : {}),
      ...(baseDir ? { OSG_FLEET_BASE_DIR: baseDir } : {}),
      ...(runtimePrefix ? { OSG_FLEET_RUNTIME_PREFIX: runtimePrefix } : {}),
      ...(workspacePrefix ? { OSG_FLEET_WORKSPACE_PREFIX: workspacePrefix } : {}),
      ...(hostPrefix ? { OSG_FLEET_HOST_PREFIX: hostPrefix } : {}),
      ...(connectTimeout ? { OSG_FLEET_CONNECT_TIMEOUT_MS: connectTimeout } : {}),
    });
    return;
  }

  process.stderr.write(`unknown command: ${command}\n\n`);
  usage();
  process.exitCode = 1;
}

run();
