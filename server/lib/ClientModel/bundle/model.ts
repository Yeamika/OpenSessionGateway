import { createRuntimeMailboxReminder, hydrateRuntimeMailboxReminder, type RuntimeMailboxReminder, type RuntimeMailboxRow } from "@/lib/ClientModel/mailbox/model";
import { createRuntimeMcpState, hydrateRuntimeMcpState, type RuntimeMcpState } from "@/lib/ClientModel/mcp/model";
import { type RuntimeTimerRow } from "@/lib/ClientModel/timer/model";
import { createRuntimeWsBridge, hydrateRuntimeWsBridge, type RuntimeWsBridge } from "@/lib/ClientModel/ws-bridge/model";

export type RuntimeBundle = {
  runtimeID: string;
  wsBridge: RuntimeWsBridge;
  mcp: RuntimeMcpState;
  mailboxReminder: RuntimeMailboxReminder;
  mailbox: RuntimeMailboxRow[];
  timers: RuntimeTimerRow[];
};

export function createRuntimeBundle(runtimeID: string): RuntimeBundle {
  return {
    runtimeID,
    wsBridge: createRuntimeWsBridge(),
    mcp: createRuntimeMcpState(),
    mailboxReminder: createRuntimeMailboxReminder(),
    mailbox: [],
    timers: [],
  };
}

export function hydrateRuntimeBundle(bundle: RuntimeBundle): RuntimeBundle {
  bundle.wsBridge = hydrateRuntimeWsBridge(bundle.wsBridge);
  bundle.mcp = hydrateRuntimeMcpState(bundle.mcp);
  bundle.mailboxReminder = hydrateRuntimeMailboxReminder(bundle.mailboxReminder);

  if (!Array.isArray(bundle.mailbox)) {
    bundle.mailbox = [];
  }
  if (!Array.isArray(bundle.timers)) {
    bundle.timers = [];
  }
  return bundle;
}
