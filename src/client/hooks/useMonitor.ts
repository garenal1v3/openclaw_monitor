import { useEffect, useRef, useState, useCallback } from "react";
import type {
  AgentStatus,
  MonitorEvent,
  Interaction,
  WsServerMessage,
} from "@shared/types";

const MAX_EVENTS = 200;
const INTERACTION_POLL_MS = 30_000;
const MAX_RECONNECT_DELAY = 30_000;

export interface MonitorState {
  agents: AgentStatus[];
  events: MonitorEvent[];
  interactions: Interaction[];
  connected: boolean;
}

export function useMonitor(): MonitorState {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const fetchInteractions = useCallback(async () => {
    try {
      const res = await fetch("/api/interactions?since=0");
      if (res.ok) {
        const data = (await res.json()) as Interaction[];
        if (!unmountedRef.current) setInteractions(data);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) {
          ws.close();
          return;
        }
        setConnected(true);
        reconnectAttempt.current = 0;
      };

      ws.onmessage = (ev) => {
        if (unmountedRef.current) return;
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as WsServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "init":
            setAgents(msg.data.agents);
            setEvents(msg.data.recentEvents.slice(0, MAX_EVENTS));
            break;
          case "event":
            setEvents((prev) => [msg.data, ...prev].slice(0, MAX_EVENTS));
            break;
          case "agents_update":
            setAgents(msg.data);
            break;
        }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    }

    function scheduleReconnect() {
      if (unmountedRef.current) return;
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempt.current),
        MAX_RECONNECT_DELAY,
      );
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    }

    connect();
    fetchInteractions();
    const pollInterval = setInterval(fetchInteractions, INTERACTION_POLL_MS);

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      clearInterval(pollInterval);
      wsRef.current?.close();
    };
  }, [fetchInteractions]);

  return { agents, events, interactions, connected };
}
