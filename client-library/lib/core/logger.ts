export type ToastHandler = (type: string, message: string, subtitle?: string) => void | Promise<void>;

export class OSGLogger {
  private readonly logStream: { write: (line: string) => unknown };
  private readonly showToast?: ToastHandler;

  constructor(logStream: { write: (line: string) => unknown }, showToast?: ToastHandler) {
    this.logStream = logStream;
    this.showToast = showToast;
  }

  log(level: string, message: string, extra?: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      message,
    };
    if (extra && typeof extra === "object") {
      payload.extra = extra;
    }
    this.logStream.write(`${JSON.stringify(payload)}\n`);
  }

  info(message: string, extra?: Record<string, unknown>) {
    this.log("info", message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>) {
    this.log("warn", message, extra);
  }

  error(message: string, extra?: Record<string, unknown>) {
    this.log("error", message, extra);
  }

  async toast(type: string, message: string, subtitle?: string) {
    this.info("toast", { type, message, subtitle });
    if (typeof this.showToast === "function") {
      await Promise.resolve(this.showToast(type, message, subtitle)).catch(() => {});
    }
  }
}
