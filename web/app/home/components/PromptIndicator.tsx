import { SPIN } from "../constants";
import type { ClientItem } from "../types";
import { promptClass } from "../utils";

export function PromptIndicator({ client, spin, delay }: { client: ClientItem; spin: number; delay: number }) {
  const cls = `nancy-prompt ${promptClass(client.sessionState, client.status)}`;
  if (client.status === "offline") {
    return <div className={cls}><span className="nancy-prompt-offline">!</span></div>;
  }
  if (client.sessionState === "stopped" || client.sessionState === "waiting") {
    return <div className={cls}><span className="nancy-prompt-error">!</span></div>;
  }
  if (client.sessionState === "busy") {
    return <div className={cls}><span className="nancy-prompt-spin">{SPIN[spin % SPIN.length]}</span></div>;
  }
  return (
    <div className={cls}>
      <span className="nancy-prompt-mark">&gt;</span>
      <span className="nancy-prompt-cursor" style={{ animationDelay: `${delay}s` }}>_</span>
    </div>
  );
}
