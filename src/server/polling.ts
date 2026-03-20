import { upsertAgent, getAgents, type Db } from "./db.js";
import type { AgentStatus } from "../shared/types.js";

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

interface PollConfig {
  gatewayUrl: string;
  gatewayToken: string;
  pollIntervalMs: number;
}

interface GatewaySession {
  key: string;
  model?: string;
  totalTokens?: number;
  contextTokens?: number;
  updatedAt?: number;
  kind?: string;
}

interface GatewayResponse {
  sessions: GatewaySession[];
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export function startPolling(
  db: Db,
  config: PollConfig,
  broadcastAgents: (agents: AgentStatus[]) => void,
): void {
  pollingInterval = setInterval(() => {
    pollSessions(db, config, broadcastAgents).catch((err: unknown) => {
      console.error("[polling] unexpected error in interval:", err);
    });
  }, config.pollIntervalMs);
}

export function stopPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export async function pollSessions(
  db: Db,
  config: PollConfig,
  broadcastAgents: (agents: AgentStatus[]) => void,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(config.gatewayUrl + "/tools/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.gatewayToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool: "sessions_list", action: "json", args: { activeMinutes: 120 } }),
    });
  } catch (err) {
    console.error("[polling] gateway unreachable:", err);
    return;
  }

  let data: GatewayResponse;
  try {
    data = (await response.json()) as GatewayResponse;
  } catch (err) {
    console.error("[polling] failed to parse gateway response:", err);
    return;
  }

  const sessions = data.sessions ?? [];
  const now = Date.now();

  const grouped = new Map<
    string,
    { model: string | null; totalTokens: number; contextTokens: number; sessionCount: number; latestUpdatedAt: number }
  >();

  for (const session of sessions) {
    const parts = session.key?.split(":") ?? [];
    if (parts[0] !== "agent" || parts.length < 2) {
      continue;
    }

    const agentId = parts[1];
    const updatedAt = session.updatedAt ?? 0;
    const existing = grouped.get(agentId);

    if (existing === undefined) {
      grouped.set(agentId, {
        model: session.model ?? null,
        totalTokens: session.totalTokens ?? 0,
        contextTokens: session.contextTokens ?? 0,
        sessionCount: 1,
        latestUpdatedAt: updatedAt,
      });
    } else {
      existing.totalTokens += session.totalTokens ?? 0;
      existing.contextTokens = Math.max(existing.contextTokens, session.contextTokens ?? 0);
      existing.sessionCount += 1;
      existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, updatedAt);
    }
  }

  for (const [agentId, agg] of grouped) {
    const status: AgentStatus["status"] =
      now - agg.latestUpdatedAt <= ACTIVE_THRESHOLD_MS ? "active" : "idle";

    upsertAgent(db, {
      agentId,
      name: null,
      status,
      model: agg.model,
      totalTokens: agg.totalTokens,
      contextTokens: agg.contextTokens,
      sessionCount: agg.sessionCount,
      lastActiveAt: agg.latestUpdatedAt,
      updatedAt: now,
    });
  }

  broadcastAgents(getAgents(db));
}
