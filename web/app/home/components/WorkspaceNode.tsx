import type { CardPosition } from "../types";

export function WorkspaceNode({
  workspace,
  runtimeLabel,
  anchor,
  dragging,
  sessionCount,
  onPointerDown,
}: {
  workspace: string;
  runtimeLabel: string;
  anchor: CardPosition;
  dragging: boolean;
  sessionCount: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`nancy-workspace-node ${dragging ? "is-dragging" : ""}`}
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={onPointerDown}
    >
      <span className="nancy-workspace-led">
        <span className="nancy-workspace-pulse" />
        <span className="nancy-workspace-core" />
      </span>
      <span className="nancy-workspace-copy">
        <span className="nancy-workspace-label">{workspace}</span>
        <span className="nancy-workspace-meta">{runtimeLabel} · {sessionCount} fish</span>
      </span>
    </div>
  );
}
