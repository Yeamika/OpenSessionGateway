"use client";

import { useEffect, useState } from "react";
import { applyMonitorPatch, readMonitorStreamPayload } from "@/lib/monitor-contract";
import type { ClientItem } from "../types";

export function useMonitorStream() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource("/api/monitor/stream");
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    eventSource.onmessage = (event) => {
      try {
        const payload = readMonitorStreamPayload(JSON.parse(event.data));
        if (!payload) return;
        setClients((current) => applyMonitorPatch(current, payload) as ClientItem[]);
      } catch {
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return { clients, connected };
}
