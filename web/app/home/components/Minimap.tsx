import type { CardPosition } from "../types";

export function Minimap({
  minimapRef,
  runtimeKeys,
  runtimePositions,
  workspaceKeys,
  workspacePositions,
  worldWidth,
  worldHeight,
  viewRect,
  onPointerDown,
}: {
  minimapRef: React.RefObject<HTMLDivElement | null>;
  runtimeKeys: string[];
  runtimePositions: Record<string, CardPosition>;
  workspaceKeys: string[];
  workspacePositions: Record<string, CardPosition>;
  worldWidth: number;
  worldHeight: number;
  viewRect: { x: number; y: number; width: number; height: number };
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div ref={minimapRef} className="nancy-minimap" onPointerDown={onPointerDown}>
      {runtimeKeys.map((runtimeID) => {
        const anchor = runtimePositions[runtimeID];
        if (!anchor) return null;
        return (
          <span
            key={runtimeID}
            className="nancy-minimap-runtime"
            style={{
              left: `${(anchor.x / worldWidth) * 100}%`,
              top: `${(anchor.y / worldHeight) * 100}%`,
            }}
          />
        );
      })}
      {workspaceKeys.map((workspace) => {
        const anchor = workspacePositions[workspace];
        if (!anchor) return null;
        return (
          <span
            key={workspace}
            className="nancy-minimap-dot"
            style={{
              left: `${(anchor.x / worldWidth) * 100}%`,
              top: `${(anchor.y / worldHeight) * 100}%`,
            }}
          />
        );
      })}
      <div
        className="nancy-minimap-view"
        style={{
          left: `${(viewRect.x / worldWidth) * 100}%`,
          top: `${(viewRect.y / worldHeight) * 100}%`,
          width: `${Math.min(100, (viewRect.width / worldWidth) * 100)}%`,
          height: `${Math.min(100, (viewRect.height / worldHeight) * 100)}%`,
        }}
      />
    </div>
  );
}
