import fs from "node:fs/promises";
import path from "node:path";

import {
  getAllowedPluginRoots,
  getRegisteredMcpPlugin,
  listRegisteredMcpPlugins,
  listPluginSummaries,
  loadPluginFromFile,
  unloadPlugin,
} from "@/lib/plugins/host";

import type { McpPlugin } from "./types";

let autoloadPromise: Promise<void> | null = null;
let autoloadComplete = false;

function parsePluginNameSet(raw: string | undefined): Set<string> {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

type RootAutoloadConfig = {
  allow: Set<string>;
  deny: Set<string>;
  hasAllowList: boolean;
  hasDenyList: boolean;
  exists: boolean;
  configPath: string;
};

function envAutoloadConfig() {
  return {
    allow: parsePluginNameSet(process.env.OSG_PLUGIN_AUTOLOAD_ALLOW),
    deny: parsePluginNameSet(process.env.OSG_PLUGIN_AUTOLOAD_DENY),
  };
}

async function readRootAutoloadConfig(root: string): Promise<RootAutoloadConfig> {
  const configPath = path.join(root, "osg.plugins.json");
  try {
    const text = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(text) as {
      autoload?: {
        allow?: unknown;
        deny?: unknown;
      };
    };

    const hasAllowList = Array.isArray(parsed.autoload?.allow);
    const hasDenyList = Array.isArray(parsed.autoload?.deny);
    const rawAllow = Array.isArray(parsed.autoload?.allow)
      ? parsed.autoload?.allow.filter((item): item is string => typeof item === "string")
      : [];
    const rawDeny = Array.isArray(parsed.autoload?.deny)
      ? parsed.autoload?.deny.filter((item): item is string => typeof item === "string")
      : [];

    return {
      allow: new Set(rawAllow.map((item) => item.trim()).filter(Boolean)),
      deny: new Set(rawDeny.map((item) => item.trim()).filter(Boolean)),
      hasAllowList,
      hasDenyList,
      exists: true,
      configPath,
    };
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        allow: new Set<string>(),
        deny: new Set<string>(),
        hasAllowList: false,
        hasDenyList: false,
        exists: false,
        configPath,
      };
    }
    throw error;
  }
}

function isAutoloadCandidate(name: string, config: RootAutoloadConfig): boolean {
  const clean = name.trim();
  if (!clean) return false;
  if (clean.startsWith(".")) return false;
  if (clean.startsWith("_")) return false;
  const envConfig = envAutoloadConfig();
  const usesAllow = envConfig.allow.size > 0 || config.hasAllowList;
  const allow = envConfig.allow.size > 0 ? envConfig.allow : config.allow;
  const deny = new Set([...config.deny, ...envConfig.deny]);
  if (usesAllow && !allow.has(clean)) return false;
  if (deny.has(clean)) return false;
  return true;
}

export type PluginAutoloadPackage = {
  rootPath: string;
  configPath: string;
  packageName: string;
  packagePath: string;
  hidden: boolean;
  packageAutoload: boolean;
  enabled: boolean;
  envControlled: boolean;
};

export type PluginAutoloadRoot = {
  rootPath: string;
  configPath: string;
  configExists: boolean;
  allow: string[];
  deny: string[];
  hasAllowList: boolean;
  packages: PluginAutoloadPackage[];
};

async function writeRootAutoloadConfig(rootPath: string, config: RootAutoloadConfig): Promise<void> {
  const payload: {
    autoload?: {
      allow?: string[];
      deny?: string[];
    };
  } = {};

  if (config.hasAllowList || config.deny.size > 0 || config.hasDenyList) {
    payload.autoload = {};
    if (config.hasAllowList) {
      payload.autoload.allow = [...config.allow].sort((a, b) => a.localeCompare(b));
    }
    if (config.deny.size > 0 || config.hasDenyList) {
      payload.autoload.deny = [...config.deny].sort((a, b) => a.localeCompare(b));
    }
  }

  if (!payload.autoload) {
    try {
      await fs.unlink(config.configPath);
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return;
  }

  await fs.writeFile(config.configPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function listPluginAutoloadRoots(): Promise<PluginAutoloadRoot[]> {
  const roots = getAllowedPluginRoots();
  const envConfig = envAutoloadConfig();
  const list: PluginAutoloadRoot[] = [];

  for (const root of roots) {
    const config = await readRootAutoloadConfig(root);
    const rows = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return [] as Array<{ isDirectory(): boolean; name: string }>;
      }
      throw error;
    });

    const packages: PluginAutoloadPackage[] = [];
    for (const row of rows.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const packageName = row.name.trim();
      if (!packageName) continue;
      const packagePath = path.join(root, row.name);
      const hidden = packageName.startsWith(".") || packageName.startsWith("_");
      const packageAutoload = await packageAllowsAutoload(packagePath);
      const usesAllow = envConfig.allow.size > 0 || config.hasAllowList;
      const allow = envConfig.allow.size > 0 ? envConfig.allow : config.allow;
      const deny = new Set([...config.deny, ...envConfig.deny]);
      const enabled = !hidden && packageAutoload && (!usesAllow || allow.has(packageName)) && !deny.has(packageName);
      packages.push({
        rootPath: root,
        configPath: config.configPath,
        packageName,
        packagePath,
        hidden,
        packageAutoload,
        enabled,
        envControlled: envConfig.allow.size > 0 || envConfig.deny.size > 0,
      });
    }

    list.push({
      rootPath: root,
      configPath: config.configPath,
      configExists: config.exists,
      allow: [...config.allow].sort((a, b) => a.localeCompare(b)),
      deny: [...config.deny].sort((a, b) => a.localeCompare(b)),
      hasAllowList: config.hasAllowList,
      packages,
    });
  }

  return list;
}

export async function setPluginAutoloadState(rootPath: string, packageName: string, enabled: boolean): Promise<PluginAutoloadRoot> {
  const root = path.resolve(rootPath.trim());
  if (!getAllowedPluginRoots().includes(root)) {
    throw new Error(`unknown plugin root: ${rootPath}`);
  }

  const cleanName = packageName.trim();
  if (!cleanName || cleanName.startsWith(".") || cleanName.startsWith("_")) {
    throw new Error(`package cannot be toggled: ${packageName}`);
  }

  const packagePath = path.join(root, cleanName);
  const stats = await fs.stat(packagePath).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`plugin package not found: ${cleanName}`);
  }

  const config = await readRootAutoloadConfig(root);
  if (enabled) {
    if (config.hasAllowList) {
      config.allow.add(cleanName);
    }
    config.deny.delete(cleanName);
  } else {
    if (config.hasAllowList) {
      config.allow.delete(cleanName);
    }
    config.deny.add(cleanName);
    config.hasDenyList = true;
  }

  await writeRootAutoloadConfig(root, config);
  const roots = await listPluginAutoloadRoots();
  const snapshot = roots.find((item) => item.rootPath === root);
  if (!snapshot) {
    throw new Error(`failed to reload plugin config for root: ${root}`);
  }
  return snapshot;
}

function isPathInside(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export type PluginAutoloadApplyResult = {
  unloaded: string[];
  loaded: string[];
  roots: PluginAutoloadRoot[];
};

export async function applyPluginAutoloadConfig(): Promise<PluginAutoloadApplyResult> {
  const roots = await listPluginAutoloadRoots();
  const summaries = listPluginSummaries();

  const unloadIDs = new Set<string>();
  const loadPaths: string[] = [];

  for (const root of roots) {
    for (const pkg of root.packages) {
      const matched = summaries.filter((plugin) =>
        plugin.sourcePath ? isPathInside(pkg.packagePath, plugin.sourcePath) : false,
      );

      if (pkg.enabled) {
        for (const plugin of matched) {
          unloadIDs.add(plugin.id);
        }
        loadPaths.push(pkg.packagePath);
        continue;
      }

      for (const plugin of matched) {
        unloadIDs.add(plugin.id);
      }
    }
  }

  const unloaded: string[] = [];
  for (const pluginID of [...unloadIDs].sort((a, b) => a.localeCompare(b))) {
    await unloadPlugin(pluginID);
    unloaded.push(pluginID);
  }

  const loaded: string[] = [];
  for (const pluginPath of [...new Set(loadPaths)].sort((a, b) => a.localeCompare(b))) {
    const plugin = await loadPluginFromFile(pluginPath);
    loaded.push(plugin.id);
  }

  return {
    unloaded,
    loaded,
    roots: await listPluginAutoloadRoots(),
  };
}

async function packageAllowsAutoload(directoryPath: string): Promise<boolean> {
  const packageJsonPath = path.join(directoryPath, "package.json");
  try {
    const text = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(text) as {
      osgServerPlugin?: { autoload?: unknown };
    };
    if (!parsed.osgServerPlugin || typeof parsed.osgServerPlugin !== "object") {
      return true;
    }
    return parsed.osgServerPlugin.autoload !== false;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function listAutoloadEntries(root: string): Promise<string[]> {
  try {
    const config = await readRootAutoloadConfig(root);
    const rows = await fs.readdir(root, { withFileTypes: true });
    const candidates = rows
      .filter((row) => row.isDirectory() && isAutoloadCandidate(row.name, config))
      .map((row) => path.join(root, row.name));

    const allowed: string[] = [];
    for (const candidate of candidates.sort((a, b) => a.localeCompare(b))) {
      if (await packageAllowsAutoload(candidate)) {
        allowed.push(candidate);
      }
    }
    return allowed;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function ensureAutoloadPluginsLoaded(): Promise<void> {
  if (autoloadComplete) return;
  if (autoloadPromise) return autoloadPromise;

  autoloadPromise = (async () => {
    const roots = getAllowedPluginRoots();
    for (const root of roots) {
      const entries = await listAutoloadEntries(root);
      for (const entry of entries) {
        const alreadyLoaded = listPluginSummaries().some((plugin) =>
          plugin.sourcePath ? isPathInside(entry, plugin.sourcePath) : false,
        );
        if (alreadyLoaded) continue;
        await loadPluginFromFile(entry);
      }
    }
    autoloadComplete = true;
  })().catch((error) => {
    autoloadPromise = null;
    throw error;
  });

  await autoloadPromise;
}

export function listMcpPlugins(): McpPlugin[] {
  return listRegisteredMcpPlugins();
}

export function getMcpPlugin(routeSegment: string): McpPlugin | null {
  const clean = routeSegment.trim();
  if (!clean) return null;
  return getRegisteredMcpPlugin(clean);
}
