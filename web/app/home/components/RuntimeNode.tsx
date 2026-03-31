import { shortRuntimeLabel } from "../utils";
import type { CardPosition, ClientItem } from "../types";

export function RuntimeNode({
  runtimeID,
  runtimeHost,
  anchor,
  status,
  workspaceCount,
  sessionCount,
}: {
  runtimeID: string;
  runtimeHost: string | null;
  anchor: CardPosition;
  status: ClientItem["status"];
  workspaceCount: number;
  sessionCount: number;
}) {
  return (
    <div className={`nancy-runtime-node is-${status}`} style={{ left: anchor.x, top: anchor.y }}>
      <span className="nancy-runtime-body">
        <span className="nancy-runtime-eye" />
      </span>
      <span className="nancy-runtime-copy">
        <span className="nancy-runtime-title">{shortRuntimeLabel(runtimeID)}</span>
        <span className="nancy-runtime-meta">{runtimeHost || "local runtime"}</span>
        <span className="nancy-runtime-meta">{workspaceCount} workspace shoals · {sessionCount} fish</span>
      </span>
    </div>
  );
}
