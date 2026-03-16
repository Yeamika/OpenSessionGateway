import { tool } from "@opencode-ai/plugin";

export function createTools(
  ctx: any,
  query: () => Record<string, unknown>,
  writeLog: (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>,
) {
  return {
    AddPromotSelf: tool({
      description: "Add a prompt message to current session",
      args: {
        message: tool.schema.string().describe("Prompt text for current session"),
        role: tool.schema.enum(["user", "system"]).optional().describe("Message role: user|system"),
      },
      async execute(args: { message: string; role?: "user" | "system" }, context: { sessionID: string }) {
        const sessionID = typeof context.sessionID === "string" ? context.sessionID.trim() : "";
        if (!sessionID.startsWith("ses_")) {
          await writeLog("error", "AddPromotSelf invalid sessionID", {
            sessionID: sessionID || "(empty)",
          });
          return "Prompt submit failed: invalid sessionID";
        }

        const role = args.role || "user";
        const result = await ctx.client.session
          .promptAsync({
            path: { id: sessionID },
            query: query(),
            body: {
              system: role === "system" ? args.message : undefined,
              parts: [
                {
                  type: "text",
                  text: args.message,
                },
              ],
            },
          })
          .catch(() => null);

        const ok = !!result && !result.error;
        await writeLog(ok ? "info" : "error", "AddPromotSelf result", {
          sessionID,
          role,
          ok,
        });

        return ok ? "Prompt submitted" : "Prompt submit failed";
      },
    }),
  };
}
