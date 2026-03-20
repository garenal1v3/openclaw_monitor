import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerIngestRoute } from "../src/server/ingest.js";
import { createDb, getEvents, type Db } from "../src/server/db.js";

let db: Db;
let app: ReturnType<typeof Fastify>;
let broadcasted: any[];

beforeEach(async () => {
  db = createDb(":memory:");
  broadcasted = [];
  app = Fastify();
  registerIngestRoute(app, db, { ingestToken: "secret", broadcast: (e) => broadcasted.push(e) });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

describe("POST /api/v1/ingest", () => {
  it("rejects without auth token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/ingest", payload: { eventType: "message_sent", timestamp: 1000, agentId: "dev" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects with wrong token", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingest",
      headers: { authorization: "Bearer wrong" },
      payload: { eventType: "message_sent", timestamp: 1000, agentId: "dev" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts single event with valid token", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingest",
      headers: { authorization: "Bearer secret" },
      payload: { eventType: "message_sent", timestamp: 1000, agentId: "dev", content: "hello" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(getEvents(db, { limit: 10 })).toHaveLength(1);
    expect(broadcasted).toHaveLength(1);
  });

  it("accepts batch of events", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingest",
      headers: { authorization: "Bearer secret" },
      payload: [
        { eventType: "message_sent", timestamp: 1000, agentId: "dev", content: "one" },
        { eventType: "tool_call", timestamp: 1001, agentId: "dev", toolName: "exec", toolCallId: "tc-1" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
    expect(getEvents(db, { limit: 10 })).toHaveLength(2);
    expect(broadcasted).toHaveLength(2);
  });

  it("skips auth when token is empty", async () => {
    const app2 = Fastify();
    registerIngestRoute(app2, db, { ingestToken: "", broadcast: () => {} });
    await app2.ready();
    const res = await app2.inject({
      method: "POST", url: "/api/v1/ingest",
      payload: { eventType: "command", timestamp: 1, agentId: "dev", action: "new" },
    });
    expect(res.statusCode).toBe(200);
    await app2.close();
  });

  it("does not broadcast duplicate events", async () => {
    const event = { eventType: "tool_call", timestamp: 1000, agentId: "dev", toolCallId: "tc-dup", toolName: "exec" };
    await app.inject({ method: "POST", url: "/api/v1/ingest", headers: { authorization: "Bearer secret" }, payload: event });
    await app.inject({ method: "POST", url: "/api/v1/ingest", headers: { authorization: "Bearer secret" }, payload: event });
    expect(broadcasted).toHaveLength(1); // second was dedup'd
    expect(getEvents(db, { limit: 10 })).toHaveLength(1);
  });
});
