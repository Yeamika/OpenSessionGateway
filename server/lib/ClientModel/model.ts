import { listRuntimeDisplays } from "@/lib/ClientModel/display/registry";
import type { RuntimeDisplayBundle } from "@/lib/ClientModel/display/model";
import { listRuntimeSessions } from "@/lib/ClientModel/session/registry";
import type { RuntimeSessionBundle } from "@/lib/ClientModel/session/model";
import { listRuntimeInstanceWorkspaces } from "@/lib/ClientModel/instance-workspace/registry";
import type { RuntimeInstanceWorkspaceBundle } from "@/lib/ClientModel/instance-workspace/model";
import { createRuntimeWsBridge, hydrateRuntimeWsBridge, type RuntimeWsBridge } from "@/lib/ClientModel/ws-bridge";

export type RuntimeBundle = {
  runtimeID: string;
  wsBridge: RuntimeWsBridge;
  instanceWorkspaces: RuntimeInstanceWorkspaceBundle[];
  sessions: RuntimeSessionBundle[];
  displays: RuntimeDisplayBundle[];
};

export function createRuntimeBundle(runtimeID: string): RuntimeBundle {
  return {
    runtimeID,
    wsBridge: createRuntimeWsBridge(),
    instanceWorkspaces: [],
    sessions: [],
    displays: [],
  };
}

export function hydrateRuntimeBundle(bundle: RuntimeBundle): RuntimeBundle {
  bundle.wsBridge = hydrateRuntimeWsBridge(bundle.wsBridge);
  bundle.instanceWorkspaces = listRuntimeInstanceWorkspaces(bundle.runtimeID);
  bundle.sessions = listRuntimeSessions(bundle.runtimeID);
  bundle.displays = listRuntimeDisplays(bundle.runtimeID);
  return bundle;
}
