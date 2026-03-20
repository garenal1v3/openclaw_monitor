import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pollSessions } from "../src/server/polling.js";
import { createDb, getAgents, type Db } from "../src/server/db.js";

let db: Db;

beforeEach(() => { db = createDb(":memory:"); });
afterEach(() => { db.close(); });

const mockConfig = {
  gatewayUrl: "http://localhost:18789",
  gatewayToken: "test-token",
  pollIntervalMs: 5000,
};

describe("pollSessions", () => {
  it("parses gateway response and upserts agents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessions: [{
          key: "agent:dev-team-dev:main",
          agentId: "dev-team-dev",
          model: "claude-opus-4-6",
          totalTokens: 119000,
          contextTokens: 200000,
          updatedAt: Date.now(),
          kind: "direct",
        }],
      }),
    }));

    const broadcastAgents = vi.fn();
    await pollSessions(db, mockConfig, broadcastAgents);

    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("dev-team-dev");
    expect(agents[0].status).toBe("active");
    expect(agents[0].model).toBe("claude-opus-4-6");
    expect(broadcastAgents).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("classifies old sessions as idle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessions: [{
          key: "agent:dev-team-pm:main",
          model: "claude-sonnet-4-6",
          totalTokens: 5000,
          contextTokens: 1000000,
          updatedAt: Date.now() - 10 * 60 * 1000, // 10 min ago
          kind: "direct",
        }],
      }),
    }));

    await pollSessions(db, mockConfig, vi.fn());
    const agents = getAgents(db);
    expect(agents[0].status).toBe("idle");

    vi.unstubAllGlobals();
  });

  it("aggregates multiple sessions for same agent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessions: [
          { key: "agent:dev-team-dev:main", model: "opus", totalTokens: 100000, contextTokens: 200000, updatedAt: Date.now(), kind: "direct" },
          { key: "agent:dev-team-dev:spawn-1", model: "opus", totalTokens: 50000, contextTokens: 200000, updatedAt: Date.now() - 60000, kind: "direct" },
        ],
      }),
    }));

    await pollSessions(db, mockConfig, vi.fn());
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].totalTokens).toBe(150000);
    expect(agents[0].sessionCount).toBe(2);

    vi.unstubAllGlobals();
  });

  it("handles fetch failure gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(pollSessions(db, mockConfig, vi.fn())).resolves.not.toThrow();
    expect(getAgents(db)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
