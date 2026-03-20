import { ulid } from "ulid";
import { upsertAgent, getAgents, insertEvent, getMetadata, setMetadata, type Db } from "./db.js";
import type { AgentStatus, MonitorEvent } from "../shared/types.js";

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

function extractSessions(raw: unknown): GatewaySession[] {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Direct format: { sessions: [...] }
    if (Array.isArray(obj.sessions)) return obj.sessions as GatewaySession[];
    // Gateway wrapped: { ok, result: { details: { sessions: [...] } } }
    const result = obj.result as Record<string, unknown> | undefined;
    if (result) {
      const details = result.details as Record<string, unknown> | undefined;
      if (details && Array.isArray(details.sessions)) return details.sessions as GatewaySession[];
      if (Array.isArray(result.sessions)) return result.sessions as GatewaySession[];
    }
  }
  return [];
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
      body: JSON.stringify({ tool: "sessions_list", action: "json", args: {} }),
    });
  } catch (err) {
    console.error("[polling] gateway unreachable:", err);
    return;
  }

  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch (err) {
    console.error("[polling] failed to parse gateway response:", err);
    return;
  }

  // Gateway wraps response: { ok, result: { details: { sessions: [...] } } }
  const sessions = extractSessions(rawData);
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

interface HistoryMessage {
  role?: string;
  content?: string;
  timestamp?: number;
  toolResults?: Array<{ toolCallId?: string; content?: string; timestamp?: number }>;
}

interface HistoryResponse {
  messages?: HistoryMessage[];
}

export async function catchUp(db: Db, config: PollConfig): Promise<void> {
  let response: Response;

  try {
    response = await fetch(config.gatewayUrl + "/tools/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.gatewayToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool: "sessions_list", action: "json", args: {} }),
    });
  } catch (err) {
    console.error("[catchUp] gateway unreachable, skipping:", err);
    return;
  }

  let rawListData: unknown;
  try {
    rawListData = await response.json();
  } catch (err) {
    console.error("[catchUp] failed to parse sessions_list response:", err);
    return;
  }

  const sessions = extractSessions(rawListData);

  for (const session of sessions) {
    const parts = session.key?.split(":") ?? [];
    if (parts[0] !== "agent" || parts.length < 2) {
      continue;
    }

    const agentId = parts[1];
    const hwmKey = "hwm:" + agentId;
    const hwmRaw = getMetadata(db, hwmKey);
    const hwm = hwmRaw !== undefined ? parseInt(hwmRaw, 10) : 0;

    let histResponse: Response;
    try {
      histResponse = await fetch(config.gatewayUrl + "/tools/invoke", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.gatewayToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: "sessions_history",
          action: "json",
          args: { sessionKey: session.key, includeTools: true, limit: 100 },
        }),
      });
    } catch (err) {
      console.error("[catchUp] failed to fetch history for session", session.key, err);
      continue;
    }

    let histData: HistoryResponse;
    try {
      histData = (await histResponse.json()) as HistoryResponse;
    } catch (err) {
      console.error("[catchUp] failed to parse history for session", session.key, err);
      continue;
    }

    const messages = histData.messages ?? [];
    let maxTimestamp = hwm;

    for (const msg of messages) {
      const ts = msg.timestamp ?? 0;
      if (ts <= hwm) {
        continue;
      }

      if (msg.role === "user" && msg.content) {
        const event: MonitorEvent = {
          id: ulid(ts),
          timestamp: ts,
          eventType: "message_received",
          agentId,
          sessionKey: session.key,
          fromAgent: null,
          toAgent: agentId,
          content: msg.content,
          toolCallId: null,
          toolName: null,
          toolInput: null,
          toolOutput: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          metadata: null,
        };
        insertEvent(db, event);
      }

      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          const trTs = tr.timestamp ?? ts;
          if (trTs <= hwm) {
            continue;
          }
          const trEvent: MonitorEvent = {
            id: ulid(trTs),
            timestamp: trTs,
            eventType: "tool_result",
            agentId,
            sessionKey: session.key,
            fromAgent: null,
            toAgent: null,
            content: tr.content ?? null,
            toolCallId: tr.toolCallId ?? null,
            toolName: null,
            toolInput: null,
            toolOutput: tr.content ?? null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            metadata: null,
          };
          insertEvent(db, trEvent);
          maxTimestamp = Math.max(maxTimestamp, trTs);
        }
      }

      maxTimestamp = Math.max(maxTimestamp, ts);
    }

    if (maxTimestamp > hwm) {
      setMetadata(db, hwmKey, String(maxTimestamp));
    }
  }
}
