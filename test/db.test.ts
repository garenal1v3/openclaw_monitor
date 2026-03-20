import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, insertEvent, getEvents, getAgents, upsertAgent, getInteractions, deleteOldEventsBatch, getMetadata, setMetadata, type Db } from "../src/server/db.js";
import type { MonitorEvent } from "../src/shared/types.js";

let db: Db;

beforeEach(() => { db = createDb(":memory:"); });
afterEach(() => { db.close(); });

describe("insertEvent + getEvents", () => {
  it("inserts and retrieves an event with camelCase keys", () => {
    const event: MonitorEvent = {
      id: "01ABC", timestamp: 1000, eventType: "message_sent",
      agentId: "dev", sessionKey: "agent:dev:main",
      fromAgent: null, toAgent: "reviewer", content: "hello",
      toolCallId: null, toolName: null, toolInput: null, toolOutput: null,
      model: null, inputTokens: null, outputTokens: null, metadata: null,
    };
    insertEvent(db, event);
    const result = getEvents(db, { limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
    expect(result[0].eventType).toBe("message_sent");
    expect(result[0].agentId).toBe("dev");
    expect(result[0].toAgent).toBe("reviewer");
  });

  it("returns false for duplicate tool_call_id + event_type", () => {
    const e1: MonitorEvent = { id: "1", timestamp: 1, eventType: "tool_call", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: "tc-1", toolName: "exec", toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null };
    const e2: MonitorEvent = { ...e1, id: "2" };
    expect(insertEvent(db, e1)).toBe(true);
    expect(insertEvent(db, e2)).toBe(false);
  });

  it("filters by agentId", () => {
    insertEvent(db, { id: "1", timestamp: 1, eventType: "message_sent", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "2", timestamp: 2, eventType: "message_sent", agentId: "pm", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    expect(getEvents(db, { agent: "dev", limit: 10 })).toHaveLength(1);
  });

  it("filters by eventType", () => {
    insertEvent(db, { id: "1", timestamp: 1, eventType: "tool_call", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: "tc-a", toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "2", timestamp: 2, eventType: "message_sent", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    expect(getEvents(db, { type: "tool_call", limit: 10 })).toHaveLength(1);
  });
});

describe("upsertAgent + getAgents", () => {
  it("inserts and retrieves agents with camelCase keys", () => {
    upsertAgent(db, { agentId: "dev", name: "Developer", status: "active", model: "opus-4", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1000, updatedAt: 1000 });
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("dev");
    expect(agents[0].status).toBe("active");
    expect(agents[0].totalTokens).toBe(100);
    expect(agents[0].contextTokens).toBe(200000);
  });

  it("upserts existing agent", () => {
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "idle", model: "opus", totalTokens: 0, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 2, updatedAt: 2 });
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe("active");
    expect(agents[0].totalTokens).toBe(100);
  });
});

describe("getInteractions", () => {
  it("aggregates agent-to-agent interactions", () => {
    insertEvent(db, { id: "1", timestamp: 100, eventType: "message_received", agentId: "dev", sessionKey: null, fromAgent: "pm", toAgent: "dev", content: "task 1", toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "2", timestamp: 200, eventType: "message_received", agentId: "dev", sessionKey: null, fromAgent: "pm", toAgent: "dev", content: "task 2", toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "3", timestamp: 300, eventType: "message_received", agentId: "reviewer", sessionKey: null, fromAgent: "dev", toAgent: "reviewer", content: "PR ready", toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });

    const interactions = getInteractions(db, { since: 0 });
    expect(interactions).toHaveLength(2);
    const pmToDev = interactions.find(i => i.fromAgent === "pm" && i.toAgent === "dev");
    expect(pmToDev?.count).toBe(2);
    expect(pmToDev?.lastContent).toBe("task 2");
  });
});

describe("deleteOldEventsBatch", () => {
  it("deletes events older than threshold", () => {
    insertEvent(db, { id: "1", timestamp: 100, eventType: "command", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "2", timestamp: 200, eventType: "command", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    insertEvent(db, { id: "3", timestamp: 300, eventType: "command", agentId: "dev", sessionKey: null, fromAgent: null, toAgent: null, content: null, toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    const deleted = deleteOldEventsBatch(db, 250);
    expect(deleted).toBe(2);
    expect(getEvents(db, { limit: 10 })).toHaveLength(1);
  });
});

describe("metadata", () => {
  it("sets and gets metadata", () => {
    setMetadata(db, "hwm:dev", "1000");
    expect(getMetadata(db, "hwm:dev")).toBe("1000");
  });

  it("upserts existing key", () => {
    setMetadata(db, "hwm:dev", "1000");
    setMetadata(db, "hwm:dev", "2000");
    expect(getMetadata(db, "hwm:dev")).toBe("2000");
  });

  it("returns undefined for missing key", () => {
    expect(getMetadata(db, "nonexistent")).toBeUndefined();
  });
});
