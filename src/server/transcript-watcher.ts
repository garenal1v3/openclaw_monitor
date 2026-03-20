import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { join, basename } from "path";
import { ulid } from "ulid";
import { insertEvent, type Db } from "./db.js";
import type { MonitorEvent } from "../shared/types.js";

interface FileState {
  path: string;
  offset: number;
  agentId: string;
  sessionKey: string;
}

const fileStates = new Map<string, FileState>();

function extractAgentId(filePath: string): string {
  const parts = filePath.split("/");
  const agentsIdx = parts.indexOf("agents");
  return agentsIdx >= 0 && agentsIdx + 1 < parts.length ? parts[agentsIdx + 1] : "unknown";
}

export function parseJsonlEntry(line: string, agentId: string, sessionKey: string): MonitorEvent[] {
  const events: MonitorEvent[] = [];
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return events;
  }

  if (entry.type === "message" && entry.message) {
    const msg = entry.message as Record<string, unknown>;
    const ts =
      typeof msg.timestamp === "number"
        ? msg.timestamp
        : typeof entry.timestamp === "string"
          ? new Date(entry.timestamp as string).getTime()
          : Date.now();

    if (msg.role === "user") {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text")
          .map((b) => b.text as string)
          .join("\n");
      }

      const prov = msg.provenance as Record<string, unknown> | undefined;
      let fromAgent: string | null = null;
      if (prov?.kind === "inter_session" && typeof prov.sourceSessionKey === "string") {
        const parts = prov.sourceSessionKey.split(":");
        if (parts[0] === "agent" && parts[1]) fromAgent = parts[1];
      }

      events.push({
        id: ulid(ts),
        timestamp: ts,
        eventType: "message_received",
        agentId,
        sessionKey,
        fromAgent,
        toAgent: agentId,
        content: content.slice(0, 2000),
        toolCallId: null,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        metadata: prov ? JSON.stringify(prov) : null,
      });
    } else if (msg.role === "assistant") {
      if (!Array.isArray(msg.content)) return events;

      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && block.text) {
          events.push({
            id: ulid(ts),
            timestamp: ts,
            eventType: "message_sent",
            agentId,
            sessionKey,
            fromAgent: agentId,
            toAgent: null,
            content: (block.text as string).slice(0, 2000),
            toolCallId: null,
            toolName: null,
            toolInput: null,
            toolOutput: null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            metadata: null,
          });
        } else if (block.type === "thinking" && block.thinking) {
          events.push({
            id: ulid(ts),
            timestamp: ts,
            eventType: "reasoning",
            agentId,
            sessionKey,
            fromAgent: null,
            toAgent: null,
            content: (block.thinking as string).slice(0, 5000),
            toolCallId: null,
            toolName: null,
            toolInput: null,
            toolOutput: null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            metadata: null,
          });
        } else if (block.type === "toolCall") {
          events.push({
            id: ulid(ts),
            timestamp: ts,
            eventType: "tool_call",
            agentId,
            sessionKey,
            fromAgent: null,
            toAgent: null,
            content: null,
            toolCallId: (block.id as string) || null,
            toolName: (block.name as string) || null,
            toolInput: block.arguments ? JSON.stringify(block.arguments) : null,
            toolOutput: null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            metadata: null,
          });
        }
      }
    } else if (msg.role === "toolResult") {
      let content = "";
      if (Array.isArray(msg.content)) {
        content = (msg.content as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text")
          .map((b) => b.text as string)
          .join("\n");
      }
      events.push({
        id: ulid(ts),
        timestamp: ts,
        eventType: "tool_result",
        agentId,
        sessionKey,
        fromAgent: null,
        toAgent: null,
        content: null,
        toolCallId: (msg.toolCallId as string) || null,
        toolName: null,
        toolInput: null,
        toolOutput: content.slice(0, 5000),
        model: null,
        inputTokens: null,
        outputTokens: null,
        metadata: null,
      });
    }
  } else if (entry.type === "model_change") {
    events.push({
      id: ulid(Date.now()),
      timestamp: Date.now(),
      eventType: "lifecycle",
      agentId,
      sessionKey,
      fromAgent: null,
      toAgent: null,
      content: `Model changed to ${entry.modelId as string}`,
      toolCallId: null,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      model: (entry.modelId as string) || null,
      inputTokens: null,
      outputTokens: null,
      metadata: null,
    });
  }

  return events;
}

function processNewLines(
  filePath: string,
  state: FileState,
  db: Db,
  broadcast: (event: MonitorEvent) => void,
): void {
  try {
    const stats = statSync(filePath);
    if (stats.size <= state.offset) return;

    const bufSize = stats.size - state.offset;
    const buf = Buffer.alloc(bufSize);
    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buf, 0, bufSize, state.offset);
    } finally {
      closeSync(fd);
    }

    state.offset = stats.size;

    const text = buf.toString("utf-8");
    const lines = text.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      const events = parseJsonlEntry(line, state.agentId, state.sessionKey);
      for (const event of events) {
        if (insertEvent(db, event)) {
          broadcast(event);
        }
      }
    }
  } catch {
    // File might be gone or locked, skip silently
  }
}

export function discoverSessionFiles(openclawHome: string): string[] {
  const agentsDir = join(openclawHome, "agents");
  const files: string[] = [];

  if (!existsSync(agentsDir)) return files;

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(agentsDir);
  } catch {
    return files;
  }

  for (const agentDir of agentDirs) {
    const sessionsDir = join(agentsDir, agentDir, "sessions");
    if (!existsSync(sessionsDir)) continue;

    let sessionFiles: string[];
    try {
      sessionFiles = readdirSync(sessionsDir);
    } catch {
      continue;
    }

    for (const file of sessionFiles) {
      if (file.endsWith(".jsonl")) {
        files.push(join(sessionsDir, file));
      }
    }
  }

  return files;
}

export function startTranscriptWatcher(
  db: Db,
  openclawHome: string,
  broadcast: (event: MonitorEvent) => void,
  intervalMs: number = 3000,
): { stop: () => void } {
  function refreshFiles(): void {
    const files = discoverSessionFiles(openclawHome);
    for (const filePath of files) {
      if (!fileStates.has(filePath)) {
        const agentId = extractAgentId(filePath);
        const sessionId = basename(filePath, ".jsonl");
        const sessionKey = `agent:${agentId}:${sessionId}`;
        // Start from end of file to avoid replaying history
        let size = 0;
        try {
          size = existsSync(filePath) ? statSync(filePath).size : 0;
        } catch {
          // File might have disappeared between discovery and stat
        }
        fileStates.set(filePath, {
          path: filePath,
          offset: size,
          agentId,
          sessionKey,
        });
      }
    }
  }

  refreshFiles();

  const timer = setInterval(() => {
    refreshFiles();

    for (const [filePath, state] of fileStates) {
      processNewLines(filePath, state, db, broadcast);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
