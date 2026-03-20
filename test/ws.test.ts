import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { createWsHandler } from "../src/server/ws.js";
import { createDb, upsertAgent, type Db } from "../src/server/db.js";
import type { WsServerMessage, MonitorEvent } from "../src/shared/types.js";

let db: Db;
let app: ReturnType<typeof Fastify>;
let port: number;
let handler: ReturnType<typeof createWsHandler>;

beforeEach(async () => {
  db = createDb(":memory:");
  app = Fastify();
  await app.register(fastifyWebsocket);
  handler = createWsHandler(db);
  handler.registerWsRoute(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as any).port;
});
afterEach(async () => { await app.close(); db.close(); });

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function makeMessageQueue(ws: WebSocket) {
  const queue: WsServerMessage[] = [];
  const waiting: Array<(msg: WsServerMessage) => void> = [];
  ws.on("message", (data) => {
    const msg: WsServerMessage = JSON.parse(data.toString());
    if (waiting.length > 0) {
      waiting.shift()!(msg);
    } else {
      queue.push(msg);
    }
  });
  return {
    next(): Promise<WsServerMessage> {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}

describe("WebSocket", () => {
  it("sends init on connect with agents and recent events", async () => {
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 0, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    const ws = await connect();
    const mq = makeMessageQueue(ws);
    const msg = await mq.next();
    expect(msg.type).toBe("init");
    if (msg.type === "init") {
      expect(msg.data.agents).toHaveLength(1);
      expect(Array.isArray(msg.data.recentEvents)).toBe(true);
    }
    ws.close();
  });

  it("broadcasts events to connected clients", async () => {
    const ws = await connect();
    const mq = makeMessageQueue(ws);
    await mq.next(); // consume init
    const event: MonitorEvent = {
      id: "test-1", timestamp: Date.now(), eventType: "message_sent",
      agentId: "dev", sessionKey: null, fromAgent: null, toAgent: "rev",
      content: "hello", toolCallId: null, toolName: null, toolInput: null,
      toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null,
    };
    handler.broadcast(event);
    const msg = await mq.next();
    expect(msg.type).toBe("event");
    if (msg.type === "event") {
      expect(msg.data.content).toBe("hello");
    }
    ws.close();
  });

  it("respects subscribe filters", async () => {
    const ws = await connect();
    const mq = makeMessageQueue(ws);
    await mq.next(); // consume init

    // Subscribe only to dev agent
    ws.send(JSON.stringify({ type: "subscribe", agents: ["dev"] }));

    // Small delay for subscribe to be processed
    await new Promise(r => setTimeout(r, 50));

    // Broadcast event from pm (should be filtered)
    handler.broadcast({
      id: "pm-1", timestamp: Date.now(), eventType: "message_sent",
      agentId: "pm", sessionKey: null, fromAgent: null, toAgent: null,
      content: "filtered", toolCallId: null, toolName: null, toolInput: null,
      toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null,
    });

    // Broadcast event from dev (should arrive)
    handler.broadcast({
      id: "dev-1", timestamp: Date.now(), eventType: "message_sent",
      agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null,
      content: "delivered", toolCallId: null, toolName: null, toolInput: null,
      toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null,
    });

    const msg = await mq.next();
    expect(msg.type).toBe("event");
    if (msg.type === "event") {
      expect(msg.data.content).toBe("delivered");
      expect(msg.data.agentId).toBe("dev");
    }
    ws.close();
  });

  it("broadcasts agents update", async () => {
    const ws = await connect();
    const mq = makeMessageQueue(ws);
    await mq.next(); // consume init
    handler.broadcastAgents([{ agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 }]);
    const msg = await mq.next();
    expect(msg.type).toBe("agents_update");
    if (msg.type === "agents_update") {
      expect(msg.data).toHaveLength(1);
    }
    ws.close();
  });
});
