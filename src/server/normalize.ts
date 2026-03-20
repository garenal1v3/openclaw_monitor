import { ulid } from "ulid";
import type { IngestEvent, MonitorEvent } from "../shared/types.js";

type MessageBlock = {
  type: string;
  thinking?: string;
  text?: string;
};

type Message = {
  role: string;
  content: MessageBlock[];
};

export function normalizeIngestEvent(raw: IngestEvent): MonitorEvent[] {
  if (raw.eventType === "agent_end") {
    return normalizeAgentEnd(raw);
  }

  const event: MonitorEvent = {
    id: ulid(raw.timestamp),
    timestamp: raw.timestamp,
    eventType: raw.eventType as MonitorEvent["eventType"],
    agentId: raw.agentId ?? null,
    sessionKey: raw.sessionKey ?? null,
    fromAgent: raw.from ?? null,
    toAgent: raw.to ?? null,
    content: raw.eventType === "command" ? (raw.action ?? null) : (raw.content ?? null),
    toolCallId: raw.toolCallId ?? null,
    toolName: raw.toolName ?? null,
    toolInput: raw.toolInput !== undefined ? JSON.stringify(raw.toolInput) : null,
    toolOutput: raw.toolOutput !== undefined ? JSON.stringify(raw.toolOutput) : null,
    model: (raw.metadata?.model as string | undefined) ?? null,
    inputTokens: null,
    outputTokens: null,
    metadata: raw.provenance !== undefined ? JSON.stringify(raw.provenance) : null,
  };

  return [event];
}

export function normalizeAgentEnd(raw: IngestEvent): MonitorEvent[] {
  const messages = (raw.messages ?? []) as Message[];
  const events: MonitorEvent[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        events.push({
          id: ulid(raw.timestamp),
          timestamp: raw.timestamp,
          eventType: "reasoning",
          agentId: raw.agentId ?? null,
          sessionKey: raw.sessionKey ?? null,
          fromAgent: null,
          toAgent: null,
          content: block.thinking,
          toolCallId: null,
          toolName: null,
          toolInput: null,
          toolOutput: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          metadata: null,
        });
      }
    }
  }

  if (events.length > 0) {
    const last = events[events.length - 1];
    last.inputTokens = (raw.metadata?.inputTokens as number | undefined) ?? null;
    last.outputTokens = (raw.metadata?.outputTokens as number | undefined) ?? null;
  }

  return events;
}
