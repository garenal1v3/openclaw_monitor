import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerQueryRoutes } from "../src/server/routes.js";
import { createDb, insertEvent, upsertAgent, type Db } from "../src/server/db.js";
import type { MonitorEvent } from "../src/shared/types.js";

let db: Db;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  db = createDb(":memory:");
  app = Fastify();
  registerQueryRoutes(app, db);
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const makeEvent = (overrides: Partial<MonitorEvent> & { id: string; timestamp: number; eventType: MonitorEvent["eventType"] }): MonitorEvent => ({
  agentId: null, sessionKey: null, fromAgent: null, toAgent: null, content: null,
  toolCallId: null, toolName: null, toolInput: null, toolOutput: null,
  model: null, inputTokens: null, outputTokens: null, metadata: null,
  ...overrides,
});

describe("GET /api/agents", () => {
  it("returns empty array initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns agents after upsert", async () => {
    upsertAgent(db, { agentId: "dev", name: "Developer", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    const agents = res.json();
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("dev");
  });
});

describe("GET /api/events", () => {
  it("returns events with camelCase keys", async () => {
    insertEvent(db, makeEvent({ id: "1", timestamp: 1000, eventType: "message_sent", agentId: "dev", toAgent: "rev", content: "hi" }));
    const res = await app.inject({ method: "GET", url: "/api/events?limit=10" });
    const events = res.json();
    expect(events[0].eventType).toBe("message_sent");
    expect(events[0].agentId).toBe("dev");
  });

  it("filters by agent", async () => {
    insertEvent(db, makeEvent({ id: "1", timestamp: 1, eventType: "command", agentId: "dev" }));
    insertEvent(db, makeEvent({ id: "2", timestamp: 2, eventType: "command", agentId: "pm" }));
    const res = await app.inject({ method: "GET", url: "/api/events?agent=dev&limit=10" });
    expect(res.json()).toHaveLength(1);
  });

  it("filters by type", async () => {
    insertEvent(db, makeEvent({ id: "1", timestamp: 1, eventType: "tool_call", agentId: "dev", toolCallId: "tc-a" }));
    insertEvent(db, makeEvent({ id: "2", timestamp: 2, eventType: "message_sent", agentId: "dev" }));
    const res = await app.inject({ method: "GET", url: "/api/events?type=tool_call&limit=10" });
    expect(res.json()).toHaveLength(1);
  });
});

describe("GET /api/interactions", () => {
  it("returns aggregated interactions", async () => {
    insertEvent(db, makeEvent({ id: "1", timestamp: 100, eventType: "message_received", agentId: "dev", fromAgent: "pm", toAgent: "dev", content: "task" }));
    const res = await app.inject({ method: "GET", url: "/api/interactions?since=0" });
    const interactions = res.json();
    expect(interactions).toHaveLength(1);
    expect(interactions[0].fromAgent).toBe("pm");
  });
});
