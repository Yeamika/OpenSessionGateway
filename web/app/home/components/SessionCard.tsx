import { Pin, PinOff } from "lucide-react";
import type { ClientItem, CardPosition } from "../types";
import { cardClass, clientSize, displayTitle, sessionLampColor, sessionStatusLabel, statusLabel, shortRuntimeLabel, workspaceLabel } from "../utils";
import { PromptIndicator } from "./PromptIndicator";

export function SessionCard({
  client,
  index,
  spin,
  pos,
  pinned,
  dragging,
  onDragStart,
  onTogglePin,
}: {
  client: ClientItem;
  index: number;
  spin: number;
  pos: CardPosition;
  pinned: boolean;
  dragging: boolean;
  onDragStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTogglePin: () => void;
}) {
  const size = clientSize(client);

  return (
    <article
      onPointerDown={onDragStart}
      className={`nancy-client-card ${cardClass(client)} ${pinned ? "is-pinned" : ""} ${dragging ? "is-dragging" : ""}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        ["--nancy-card-width" as string]: `${size.width}px`,
        ["--nancy-card-height" as string]: `${size.height}px`,
      }}
    >
      <div className="nancy-card-bar">
        <div className="nancy-lamp-wrap">
          <span
            className="nancy-lamp"
            style={{
              backgroundColor: sessionLampColor(client.sessionStatus, client.status),
              animationDelay: `${(index % 9) * 0.18}s`,
            }}
          />
          <div className="nancy-lamp-tip">
            <div>status: {statusLabel(client.status)}</div>
            <div>session status: {sessionStatusLabel(client.sessionStatus)}</div>
            <div>runtimeID: {client.runtimeID}</div>
            <div>displayID: {client.displayID ?? "null"}</div>
            <div>title: {displayTitle(client)}</div>
            <div>sessionID: {client.sessionID ?? "null"}</div>
            <div>workspace: {client.workspace ?? "null"}</div>
            <div>host: {client.runtimeHost ?? "null"}</div>
          </div>
        </div>
        <div className="nancy-card-title">{displayTitle(client)}</div>
        {client.displayID && (
          <button
            type="button"
            className={`nancy-pin ${pinned ? "is-pinned" : ""}`}
            title={pinned ? "unpin" : "pin card"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onTogglePin}
          >
            {pinned ? <Pin size={13} strokeWidth={2} /> : <PinOff size={13} strokeWidth={2} />}
          </button>
        )}
      </div>

      <div className="nancy-card-body">
        <div className="nancy-card-tail" aria-hidden />
        <div className="nancy-card-school">
          {client.synthetic ? <span className="nancy-card-chip">template</span> : null}
          <span className="nancy-card-chip">{shortRuntimeLabel(client.runtimeID)}</span>
          <span className="nancy-card-chip">{workspaceLabel(client.workspace)}</span>
        </div>
        <PromptIndicator client={client} spin={spin} delay={(index % 11) * 0.11} />
      </div>
    </article>
  );
}
