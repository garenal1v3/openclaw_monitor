export interface MonitorEvent {
  id: string;
  timestamp: number;
  eventType: "message_received" | "message_sent" | "tool_call" | "tool_result" | "reasoning" | "command" | "lifecycle";
  agentId: string | null;
  sessionKey: string | null;
  fromAgent: string | null;
  toAgent: string | null;
  content: string | null;
  toolCallId: string | null;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: string | null;
}

export interface AgentStatus {
  agentId: string;
  name: string | null;
  status: "active" | "idle" | "unknown";
  model: string | null;
  totalTokens: number;
  contextTokens: number;
  sessionCount: number;
  lastActiveAt: number | null;
  updatedAt: number | null;
}

export interface Interaction {
  fromAgent: string;
  toAgent: string;
  count: number;
  lastAt: number;
  lastContent: string | null;
}

export type WsClientMessage =
  | { type: "subscribe"; agents?: string[]; eventTypes?: string[] }
  | { type: "unsubscribe" };

export type WsServerMessage =
  | { type: "init"; data: { agents: AgentStatus[]; recentEvents: MonitorEvent[] } }
  | { type: "event"; data: MonitorEvent }
  | { type: "agents_update"; data: AgentStatus[] };

export interface IngestEvent {
  eventType: string;
  timestamp: number;
  agentId?: string | null;
  sessionKey?: string;
  from?: string | null;
  to?: string | null;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  provenance?: Record<string, unknown>;
  action?: string;
  messages?: unknown[];
  metadata?: Record<string, unknown>;
}
