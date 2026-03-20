import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { createWsHandler } from "../src/server/ws.js";
import { createDb, upsertAgent, type Db } from "../src/server/db.js";
import type { WsServerMessage } from "../src/shared/types.js";

let db: Db;
let app: ReturnType<typeof Fastify>;
let port: number;
let handler: ReturnType<typeof createWsHandler>;
let openSockets: WebSocket[];

beforeEach(async () => {
  openSockets = [];
  db = createDb(":memory:");
  app = Fastify();
  await app.register(fastifyWebsocket);
  handler = createWsHandler(db);
  handler.registerWsRoute(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as any).port;
});

afterEach(async () => {
  await Promise.all(openSockets.map(ws =>
    new Promise<void>(resolve => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.on("close", () => resolve());
      ws.close();
    })
  ));
  await app.close();
  db.close();
});

/** Connect and attach message queue BEFORE open resolves — guarantees no missed messages */
function connectWithQueue(): Promise<{ ws: WebSocket; mq: ReturnType<typeof makeMessageQueue> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    openSockets.push(ws);
    const mq = makeMessageQueue(ws); // attach handler before open fires
    ws.on("open", () => resolve({ ws, mq }));
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
    const { mq } = await connectWithQueue();
    const msg = await mq.next();
    expect(msg.type).toBe("init");
    if (msg.type === "init") {
      expect(msg.data.agents).toHaveLength(1);
      expect(Array.isArray(msg.data.recentEvents)).toBe(true);
    }
  });

  it("broadcasts events to connected clients", async () => {
    const { mq } = await connectWithQueue();
    await mq.next(); // consume init
    handler.broadcast({
      id: "test-1", timestamp: Date.now(), eventType: "message_sent",
      agentId: "dev", sessionKey: null, fromAgent: null, toAgent: "rev",
      content: "hello", toolCallId: null, toolName: null, toolInput: null,
      toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null,
    });
    const msg = await mq.next();
    expect(msg.type).toBe("event");
    if (msg.type === "event") {
      expect(msg.data.content).toBe("hello");
    }
  });

  it("respects subscribe filters", async () => {
    const { ws, mq } = await connectWithQueue();
    await mq.next(); // consume init

    ws.send(JSON.stringify({ type: "subscribe", agents: ["dev"] }));
    await new Promise(r => setTimeout(r, 100));

    handler.broadcast({
      id: "pm-1", timestamp: Date.now(), eventType: "message_sent",
      agentId: "pm", sessionKey: null, fromAgent: null, toAgent: null,
      content: "filtered", toolCallId: null, toolName: null, toolInput: null,
      toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null,
    });
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
    }
  });

  it("broadcasts agents update", async () => {
    const { mq } = await connectWithQueue();
    await mq.next(); // consume init
    handler.broadcastAgents([{ agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 }]);
    const msg = await mq.next();
    expect(msg.type).toBe("agents_update");
    if (msg.type === "agents_update") {
      expect(msg.data).toHaveLength(1);
    }
  });
});
