import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pollSessions } from "../src/server/polling.js";
import { createDb, getAgents, type Db } from "../src/server/db.js";
import * as childProcess from "child_process";

vi.mock("child_process", async () => {
  const actual = await vi.importActual("child_process");
  return { ...actual, execFile: vi.fn() };
});

let db: Db;

beforeEach(() => { db = createDb(":memory:"); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

const mockConfig = {
  gatewayUrl: "http://localhost:18789",
  gatewayToken: "test-token",
  pollIntervalMs: 5000,
};

function mockCliOutput(json: unknown) {
  const jsonStr = JSON.stringify(json);
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      // promisify wraps execFile — it passes callback as 3rd or 4th arg
      const callback = cb || _opts as typeof cb;
      if (typeof callback === "function") {
        callback(null, { stdout: jsonStr, stderr: "" });
      }
    }
  );
}

function mockCliError() {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const callback = cb || _opts as typeof cb;
      if (typeof callback === "function") {
        callback(new Error("command failed"), { stdout: "", stderr: "error" });
      }
    }
  );
}

describe("pollSessions", () => {
  it("parses CLI output and upserts agents", async () => {
    mockCliOutput({
      sessions: [{
        key: "agent:dev-team-dev:main",
        model: "claude-opus-4-6",
        totalTokens: 119000,
        contextTokens: 200000,
        updatedAt: Date.now(),
        kind: "direct",
      }],
    });

    const broadcastAgents = vi.fn();
    await pollSessions(db, mockConfig, broadcastAgents);

    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("dev-team-dev");
    expect(agents[0].status).toBe("active");
    expect(agents[0].model).toBe("claude-opus-4-6");
    expect(broadcastAgents).toHaveBeenCalledOnce();
  });

  it("classifies old sessions as idle", async () => {
    mockCliOutput({
      sessions: [{
        key: "agent:dev-team-pm:main",
        model: "claude-sonnet-4-6",
        totalTokens: 5000,
        contextTokens: 1000000,
        updatedAt: Date.now() - 10 * 60 * 1000,
        kind: "direct",
      }],
    });

    await pollSessions(db, mockConfig, vi.fn());
    const agents = getAgents(db);
    expect(agents[0].status).toBe("idle");
  });

  it("aggregates multiple sessions for same agent", async () => {
    mockCliOutput({
      sessions: [
        { key: "agent:dev-team-dev:main", model: "opus", totalTokens: 100000, contextTokens: 200000, updatedAt: Date.now(), kind: "direct" },
        { key: "agent:dev-team-dev:spawn-1", model: "opus", totalTokens: 50000, contextTokens: 200000, updatedAt: Date.now() - 60000, kind: "direct" },
      ],
    });

    await pollSessions(db, mockConfig, vi.fn());
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].totalTokens).toBe(150000);
    expect(agents[0].sessionCount).toBe(2);
  });

  it("handles CLI failure gracefully", async () => {
    mockCliError();
    await expect(pollSessions(db, mockConfig, vi.fn())).resolves.not.toThrow();
    expect(getAgents(db)).toHaveLength(0);
  });
});
