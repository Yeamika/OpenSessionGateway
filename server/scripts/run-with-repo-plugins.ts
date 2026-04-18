import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

process.env.OSG_PLUGIN_DIRS ||= path.resolve(currentDir, "..", "..", "plugins");

void import(pathToFileURL(path.resolve(currentDir, "..", "server.ts")).href);
