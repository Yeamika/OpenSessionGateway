import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const ADD_PROMPT_TOOL = {
  name: "AddPrompt",
  description: "Direct-control only. Sends a user message with optional system info",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      msg: { type: "string", pattern: "\\S", description: "User message content" },
      system: { type: "string", description: "Optional per-turn system info" },
      source: { type: "string", description: "Optional source label recorded by OSG. Default: osg" },
    },
    required: ["runtimeID", "sessionID", "msg"],
    additionalProperties: false,
  },
};

export function createAddPromptToolHandler(services: RuntimeControlServices) {
  return async function handleAddPromptTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);
    const msg = normalizeString(args.msg);
    const system = normalizeString(args.system) || undefined;
    const source = normalizeString(args.source) || "osg";

    if (!runtimeID) throw new Error("runtimeID is required");
    if (!sessionID) throw new Error("sessionID is required");
    if (!msg) throw new Error("msg is required");

    return services.osg.addPrompt({
      runtimeID,
      sessionID,
      msg,
      system,
      source,
    });
  };
}
