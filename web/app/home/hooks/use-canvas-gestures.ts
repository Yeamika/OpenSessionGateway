"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_MARGIN } from "../constants";
import type { CardPosition, Viewport } from "../types";
import { clamp, clampViewport, clampWorkspaceAnchor, viewportFromWorldRect } from "../utils";

type WorldSize = { width: number; height: number };

export function useCanvasGestures({
  view,
  canvasRef,
  minimapRef,
  viewport,
  setViewport,
  setCanvasScale,
  world,
  positionsRef,
  setPositions,
  anchorsRef,
  manualAnchorRef,
  setWorkspacePositions,
}: {
  view: string;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  minimapRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  setCanvasScale: (scale: number) => void;
  world: WorldSize;
  positionsRef: React.MutableRefObject<Record<string, CardPosition>>;
  setPositions: React.Dispatch<React.SetStateAction<Record<string, CardPosition>>>;
  anchorsRef: React.MutableRefObject<Record<string, CardPosition>>;
  manualAnchorRef: React.MutableRefObject<Record<string, boolean>>;
  setWorkspacePositions: React.Dispatch<React.SetStateAction<Record<string, CardPosition>>>;
}) {
  const [draggingRuntimeID, setDraggingRuntimeID] = useState("");
  const [draggingWorkspace, setDraggingWorkspace] = useState("");
  const blockBackgroundRef = useRef(false);
  const viewportRef = useRef(viewport);

  const dragRef = useRef<{
    runtimeID: string;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const dragPendingRef = useRef<{ runtimeID: string; x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const workspaceDragRef = useRef<{ workspace: string; offsetX: number; offsetY: number } | null>(null);
  const minimapDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startScale: number; worldX: number; worldY: number } | null>(null);
  const workspaceDragPendingRef = useRef<{ workspace: string; x: number; y: number } | null>(null);
  const workspaceDragRafRef = useRef<number | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const clearPointerState = () => {
    touchPointsRef.current.clear();
    pinchRef.current = null;
    panDragRef.current = null;
    dragRef.current = null;
    dragPendingRef.current = null;
    workspaceDragRef.current = null;
    minimapDragRef.current = null;
    workspaceDragPendingRef.current = null;
    setDraggingRuntimeID("");
    setDraggingWorkspace("");
    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (workspaceDragRafRef.current !== null) {
      window.cancelAnimationFrame(workspaceDragRafRef.current);
      workspaceDragRafRef.current = null;
    }
  };

  useEffect(() => {
    if (view !== "nancy") return;
    const root = canvasRef.current;
    if (!root) return;

    const onPointerMove = (event: PointerEvent) => {
      try {
        const drag = dragRef.current;
        const minimap = minimapRef.current;
        const workspaceDrag = workspaceDragRef.current;
        const minimapDrag = minimapDragRef.current;

        if (touchPointsRef.current.has(event.pointerId)) {
          touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        if (minimapDrag && minimap) {
          const currentViewport = viewportRef.current;
          const rect = minimap.getBoundingClientRect();
          const nx = clamp(event.clientX - rect.left - minimapDrag.offsetX, 0, rect.width);
          const ny = clamp(event.clientY - rect.top - minimapDrag.offsetY, 0, rect.height);
          const worldX = (nx / rect.width) * world.width;
          const worldY = (ny / rect.height) * world.height;
          setViewport(viewportFromWorldRect(worldX, worldY, currentViewport.scale, root.clientWidth, root.clientHeight, world.width, world.height));
          return;
        }

        if (pinchRef.current && touchPointsRef.current.size >= 2) {
          const [a, b] = Array.from(touchPointsRef.current.values());
          if (!a || !b) return;
          const rect = root.getBoundingClientRect();
          const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const nextScale = clamp(pinchRef.current.startScale * (distance / pinchRef.current.startDistance), 0.25, 1.25);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          setCanvasScale(nextScale);
          setViewport(
            clampViewport(
              {
                scale: nextScale,
                x: midX - rect.left - pinchRef.current.worldX * nextScale,
                y: midY - rect.top - pinchRef.current.worldY * nextScale,
              },
              root.clientWidth,
              root.clientHeight,
              world.width,
              world.height,
            ),
          );
          return;
        }

        if (panDragRef.current) {
          const panDrag = panDragRef.current;
          if (!panDrag) return;
          setViewport((current) =>
            clampViewport(
              {
                ...current,
                x: panDrag.originX + (event.clientX - panDrag.startX),
                y: panDrag.originY + (event.clientY - panDrag.startY),
              },
              root.clientWidth,
              root.clientHeight,
              world.width,
              world.height,
            ),
          );
          return;
        }

        if (workspaceDrag) {
          const rect = root.getBoundingClientRect();
          const currentViewport = viewportRef.current;
          const px = (event.clientX - rect.left - currentViewport.x) / currentViewport.scale;
          const py = (event.clientY - rect.top - currentViewport.y) / currentViewport.scale;
          const nextAnchor = clampWorkspaceAnchor({ x: px - workspaceDrag.offsetX, y: py - workspaceDrag.offsetY }, world.width, world.height);
          workspaceDragPendingRef.current = { workspace: workspaceDrag.workspace, x: nextAnchor.x, y: nextAnchor.y };
          if (workspaceDragRafRef.current !== null) return;
          workspaceDragRafRef.current = window.requestAnimationFrame(() => {
            const pending = workspaceDragPendingRef.current;
            workspaceDragRafRef.current = null;
            if (!pending) return;
            manualAnchorRef.current[pending.workspace] = true;
            setWorkspacePositions((current) => {
              const next = { ...current, [pending.workspace]: { x: pending.x, y: pending.y } };
              anchorsRef.current = next;
              return next;
            });
          });
          return;
        }

        if (!drag) return;
        const rect = root.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const px = (event.clientX - rect.left - currentViewport.x) / currentViewport.scale;
        const py = (event.clientY - rect.top - currentViewport.y) / currentViewport.scale;
        const nextX = clamp(px - drag.offsetX, CARD_MARGIN, world.width - drag.width - CARD_MARGIN);
        const nextY = clamp(py - drag.offsetY, 78, world.height - drag.height - CARD_MARGIN);
        dragPendingRef.current = { runtimeID: drag.runtimeID, x: nextX, y: nextY };
        if (dragRafRef.current !== null) return;
        dragRafRef.current = window.requestAnimationFrame(() => {
          const pending = dragPendingRef.current;
          dragRafRef.current = null;
          if (!pending) return;
          setPositions((current) => {
            const next = { ...current, [pending.runtimeID]: { x: pending.x, y: pending.y } };
            positionsRef.current = next;
            return next;
          });
        });
      } catch (error) {
        console.error("nancy pointermove error", error);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (blockBackgroundRef.current) {
          blockBackgroundRef.current = false;
          return;
        }
        if (target.closest(".nancy-client-card") || target.closest(".nancy-workspace-node") || target.closest(".nancy-scale-panel")) {
          return;
        }
        if (event.pointerType === "touch") {
          touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (touchPointsRef.current.size >= 2) {
            const [a, b] = Array.from(touchPointsRef.current.values());
            if (!a || !b) return;
            const rect = root.getBoundingClientRect();
            const currentViewport = viewportRef.current;
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            pinchRef.current = {
              startDistance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
              startScale: currentViewport.scale,
              worldX: (midX - rect.left - currentViewport.x) / currentViewport.scale,
              worldY: (midY - rect.top - currentViewport.y) / currentViewport.scale,
            };
            panDragRef.current = null;
          } else {
            const currentViewport = viewportRef.current;
            panDragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              originX: currentViewport.x,
              originY: currentViewport.y,
            };
          }
        } else {
          const currentViewport = viewportRef.current;
          panDragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: currentViewport.x,
            originY: currentViewport.y,
          };
        }
      } catch (error) {
        console.error("nancy pointerdown error", error);
      }
    };

    const onPointerUp = () => {
      try {
        clearPointerState();
      } catch (error) {
        console.error("nancy pointerup error", error);
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      clearPointerState();
    };
  }, [
    anchorsRef,
    canvasRef,
    manualAnchorRef,
    minimapRef,
    positionsRef,
    setCanvasScale,
    setPositions,
    setViewport,
    setWorkspacePositions,
    view,
    world.height,
    world.width,
  ]);

  return {
    draggingRuntimeID,
    draggingWorkspace,
    startCardDrag: (runtimeID: string, pos: CardPosition, width: number, height: number, clientX: number, clientY: number) => {
      blockBackgroundRef.current = true;
      const root = canvasRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const currentViewport = viewportRef.current;
      dragRef.current = {
        runtimeID,
        offsetX: (clientX - rect.left - currentViewport.x) / currentViewport.scale - pos.x,
        offsetY: (clientY - rect.top - currentViewport.y) / currentViewport.scale - pos.y,
        width,
        height,
      };
      setDraggingRuntimeID(runtimeID);
    },
    startWorkspaceDrag: (workspace: string, anchor: CardPosition, clientX: number, clientY: number) => {
      blockBackgroundRef.current = true;
      const root = canvasRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const currentViewport = viewportRef.current;
      workspaceDragRef.current = {
        workspace,
        offsetX: (clientX - rect.left - currentViewport.x) / currentViewport.scale - anchor.x,
        offsetY: (clientY - rect.top - currentViewport.y) / currentViewport.scale - anchor.y,
      };
      setDraggingWorkspace(workspace);
    },
    startMinimapDrag: (offsetX: number, offsetY: number) => {
      blockBackgroundRef.current = true;
      minimapDragRef.current = { offsetX, offsetY };
    },
  };
}
