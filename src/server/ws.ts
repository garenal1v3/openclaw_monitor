import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { getAgents, getEvents, type Db } from "./db.js";
import type { AgentStatus, MonitorEvent, WsClientMessage, WsServerMessage } from "../shared/types.js";

interface ClientFilters {
  agents?: string[];
  eventTypes?: string[];
}

interface ConnectedClient {
  socket: WebSocket;
  filters: ClientFilters | null;
}

function matchesFilters(filters: ClientFilters | null, event: MonitorEvent): boolean {
  if (filters === null) return true;
  if (filters.agents && filters.agents.length > 0) {
    if (event.agentId === null || !filters.agents.includes(event.agentId)) return false;
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    if (!filters.eventTypes.includes(event.eventType)) return false;
  }
  return true;
}

function sendMessage(socket: WebSocket, msg: WsServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function createWsHandler(db: Db) {
  const clients = new Set<ConnectedClient>();

  function broadcast(event: MonitorEvent): void {
    for (const client of clients) {
      if (matchesFilters(client.filters, event)) {
        sendMessage(client.socket, { type: "event", data: event });
      }
    }
  }

  function broadcastAgents(agents: AgentStatus[]): void {
    for (const client of clients) {
      sendMessage(client.socket, { type: "agents_update", data: agents });
    }
  }

  function registerWsRoute(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket) => {
      const client: ConnectedClient = { socket, filters: null };
      clients.add(client);

      sendMessage(socket, {
        type: "init",
        data: {
          agents: getAgents(db),
          recentEvents: getEvents(db, { limit: 50 }),
        },
      });

      socket.on("message", (raw) => {
        let msg: WsClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as WsClientMessage;
        } catch {
          return;
        }
        if (msg.type === "subscribe") {
          client.filters = {
            agents: msg.agents,
            eventTypes: msg.eventTypes,
          };
        } else if (msg.type === "unsubscribe") {
          client.filters = null;
        }
      });

      socket.on("close", () => {
        clients.delete(client);
      });
    });
  }

  return { broadcast, broadcastAgents, registerWsRoute };
}
