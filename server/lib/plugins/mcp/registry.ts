import fs from "node:fs/promises";
import path from "node:path";

import {
  getAllowedPluginRoots,
  getRegisteredMcpPlugin,
  listRegisteredMcpPlugins,
  listPluginSummaries,
  loadPluginFromFile,
  loadPluginFromPackage,
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
  entries: PluginAutoloadEntryConfig[];
  hasAllowList: boolean;
  hasDenyList: boolean;
  exists: boolean;
  configPath: string;
};

export type PluginAutoloadEntryConfig = {
  type: "path" | "package";
  spec: string;
};

export type PluginAutoloadEntry = PluginAutoloadEntryConfig & {
  resolved: string;
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
        entries?: unknown;
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
    const rawEntries = Array.isArray(parsed.autoload?.entries) ? parsed.autoload.entries : [];
    const entries = rawEntries.flatMap((entry): PluginAutoloadEntryConfig[] => {
      if (typeof entry === "string" && entry.trim()) {
        return [{ type: "path", spec: entry.trim() }];
      }
      if (!entry || typeof entry !== "object") return [];
      const type = (entry as { type?: unknown }).type;
      const spec = (entry as { spec?: unknown }).spec;
      if ((type === "path" || type === "package") && typeof spec === "string" && spec.trim()) {
        return [{ type, spec: spec.trim() }];
      }
      return [];
    });

    return {
      allow: new Set(rawAllow.map((item) => item.trim()).filter(Boolean)),
      deny: new Set(rawDeny.map((item) => item.trim()).filter(Boolean)),
      entries,
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
        entries: [],
        hasAllowList: false,
        hasDenyList: false,
        exists: false,
        configPath,
      };
    }
    throw error;
  }
}

function resolvePackageEnabled(input: {
  hidden: boolean;
  packageName: string;
  config: RootAutoloadConfig;
  envAllow: Set<string>;
  envDeny: Set<string>;
}): boolean {
  if (input.hidden) return false;
  const usesAllow = input.envAllow.size > 0 || input.config.hasAllowList;
  const allow = input.envAllow.size > 0 ? input.envAllow : input.config.allow;
  const deny = new Set([...input.config.deny, ...input.envDeny]);
  if (deny.has(input.packageName)) return false;
  if (usesAllow) return allow.has(input.packageName);
  return true;
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
  enabled: boolean;
  envControlled: boolean;
};

export type PluginAutoloadRoot = {
  rootPath: string;
  configPath: string;
  configExists: boolean;
  allow: string[];
  deny: string[];
  entries: PluginAutoloadEntry[];
  hasAllowList: boolean;
  packages: PluginAutoloadPackage[];
};

type AutoloadLoadTarget =
  | { type: "path"; spec: string; resolved: string }
  | { type: "package"; spec: string; resolved: string };

function resolveEntryReference(rootPath: string, entry: PluginAutoloadEntryConfig): PluginAutoloadEntry {
  return {
    type: entry.type,
    spec: entry.spec,
    resolved: entry.type === "path"
      ? path.resolve(rootPath, entry.spec)
      : entry.spec,
  };
}

function pluginMatchesEntry(plugin: { sourceKind: string; sourcePath: string | null; sourceSpecifier?: string | null }, entry: AutoloadLoadTarget): boolean {
  if (entry.type === "package") {
    return plugin.sourceKind === "package" && plugin.sourceSpecifier === entry.spec;
  }
  return plugin.sourceKind === "file" && !!plugin.sourcePath && isPathInside(entry.resolved, plugin.sourcePath);
}

async function writeRootAutoloadConfig(rootPath: string, config: RootAutoloadConfig): Promise<void> {
  const payload: {
    autoload?: {
      allow?: string[];
      deny?: string[];
      entries?: PluginAutoloadEntryConfig[];
    };
  } = {};

  if (config.hasAllowList || config.deny.size > 0 || config.hasDenyList || config.entries.length > 0) {
    payload.autoload = {};
    if (config.hasAllowList) {
      payload.autoload.allow = [...config.allow].sort((a, b) => a.localeCompare(b));
    }
    if (config.deny.size > 0 || config.hasDenyList) {
      payload.autoload.deny = [...config.deny].sort((a, b) => a.localeCompare(b));
    }
    if (config.entries.length > 0) {
      payload.autoload.entries = config.entries.map((entry) => ({ type: entry.type, spec: entry.spec }));
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
      const enabled = resolvePackageEnabled({
        hidden,
        packageName,
        config,
        envAllow: envConfig.allow,
        envDeny: envConfig.deny,
      });
      packages.push({
        rootPath: root,
        configPath: config.configPath,
        packageName,
        packagePath,
        hidden,
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
      entries: config.entries.map((entry) => resolveEntryReference(root, entry)),
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
    config.allow.add(cleanName);
    config.deny.delete(cleanName);
  } else {
    config.allow.delete(cleanName);
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
  const loadTargets: AutoloadLoadTarget[] = [];

  for (const root of roots) {
    for (const pkg of root.packages) {
      const matched = summaries.filter((plugin) =>
        plugin.sourcePath ? isPathInside(pkg.packagePath, plugin.sourcePath) : false,
      );

      if (pkg.enabled) {
        for (const plugin of matched) {
          unloadIDs.add(plugin.id);
        }
        loadTargets.push({ type: "path", spec: pkg.packagePath, resolved: pkg.packagePath });
        continue;
      }

      for (const plugin of matched) {
        unloadIDs.add(plugin.id);
      }
    }

    for (const entry of root.entries) {
      const matched = summaries.filter((plugin) => pluginMatchesEntry(plugin, entry));
      for (const plugin of matched) {
        unloadIDs.add(plugin.id);
      }
      loadTargets.push(entry);
    }
  }

  const unloaded: string[] = [];
  for (const pluginID of [...unloadIDs].sort((a, b) => a.localeCompare(b))) {
    await unloadPlugin(pluginID);
    unloaded.push(pluginID);
  }

  const loaded: string[] = [];
  for (const target of [...new Map(loadTargets.map((item) => [`${item.type}:${item.resolved}`, item])).values()]
    .sort((a, b) => a.resolved.localeCompare(b.resolved))) {
    const plugin = target.type === "package"
      ? await loadPluginFromPackage(target.spec)
      : await loadPluginFromFile(target.resolved);
    loaded.push(plugin.id);
  }

  return {
    unloaded,
    loaded,
    roots: await listPluginAutoloadRoots(),
  };
}

async function listAutoloadEntries(root: string): Promise<AutoloadLoadTarget[]> {
  try {
    const config = await readRootAutoloadConfig(root);
    const envConfig = envAutoloadConfig();
    const rows = await fs.readdir(root, { withFileTypes: true });
    const candidates = await Promise.all(rows
      .filter((row) => row.isDirectory() && isAutoloadCandidate(row.name, config))
      .map(async (row) => {
        const packageName = row.name.trim();
        const packagePath = path.join(root, row.name);
        const hidden = packageName.startsWith(".") || packageName.startsWith("_");
        const enabled = resolvePackageEnabled({
          hidden,
          packageName,
          config,
          envAllow: envConfig.allow,
          envDeny: envConfig.deny,
        });
        return enabled ? ({ type: "path", spec: packagePath, resolved: packagePath } satisfies AutoloadLoadTarget) : null;
      }));

    const entries: AutoloadLoadTarget[] = candidates.filter(
      (item): item is { type: "path"; spec: string; resolved: string } => Boolean(item),
    );
    for (const entry of config.entries) {
      entries.push(resolveEntryReference(root, entry));
    }
    return [...new Map(entries.map((item) => [`${item.type}:${item.resolved}`, item])).values()]
      .sort((a, b) => a.resolved.localeCompare(b.resolved));
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
          pluginMatchesEntry(plugin, entry),
        );
        if (alreadyLoaded) continue;
        if (entry.type === "package") {
          await loadPluginFromPackage(entry.spec);
          continue;
        }
        await loadPluginFromFile(entry.resolved);
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
