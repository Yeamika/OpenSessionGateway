import path from "node:path";

const cwdAbsolute = path.resolve(process.cwd());

export function getCurrentClientInfo() {
  return {
    sessionID: "ses_template_demo",
    sessionTitle: "Template Demo Session",
    status: "Busy",
    cwd: cwdAbsolute && cwdAbsolute !== "/" ? cwdAbsolute : "unknown",
  };
}
