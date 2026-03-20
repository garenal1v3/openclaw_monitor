export default function register(api: any) {
  const MONITOR_URL = process.env.OPENCLAW_MONITOR_URL || "http://localhost:3800";
  const MONITOR_TOKEN = process.env.OPENCLAW_MONITOR_TOKEN || "";

  let buffer: Record<string, unknown>[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    flushTimer = null;
    try {
      await fetch(`${MONITOR_URL}/api/v1/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(MONITOR_TOKEN ? { Authorization: `Bearer ${MONITOR_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
      });
    } catch {
      // fire-and-forget
    }
  };

  const enqueue = (event: Record<string, unknown>) => {
    buffer.push({ ...event, timestamp: Date.now() });
    if (buffer.length >= 10) {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flush, 100);
    }
  };

  const pendingToolCalls = new Map<string, string>();

  api.registerHook("message_received", async (event: any) => {
    enqueue({
      eventType: "message_received",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      from: extractAgentId(event.context?.provenance?.sourceSessionKey),
      content: event.context?.content,
      provenance: event.context?.provenance,
    });
  }, { name: "monitor.message_received" });

  api.registerHook("message_sent", async (event: any) => {
    enqueue({
      eventType: "message_sent",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      to: event.context?.to,
      content: event.context?.content,
    });
  }, { name: "monitor.message_sent" });

  api.registerHook("before_tool_call", async (event: any) => {
    const toolCallId = event.context?.toolCallId || crypto.randomUUID();
    const correlationKey = `${event.sessionKey}:${toolCallId}`;
    pendingToolCalls.set(correlationKey, toolCallId);
    enqueue({
      eventType: "tool_call",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      toolCallId,
      toolName: event.context?.toolName,
      toolInput: event.context?.input,
    });
  }, { name: "monitor.before_tool_call" });

  api.registerHook("after_tool_call", async (event: any) => {
    const toolCallId = event.context?.toolCallId
      || findPendingToolCall(pendingToolCalls, event.sessionKey);
    enqueue({
      eventType: "tool_result",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      toolCallId,
      toolName: event.context?.toolName,
      toolOutput: event.context?.result,
    });
  }, { name: "monitor.after_tool_call" });

  api.registerHook("agent_end", async (event: any) => {
    enqueue({
      eventType: "agent_end",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      messages: event.context?.messages,
      metadata: event.context?.metadata,
    });
  }, { name: "monitor.agent_end" });

  for (const cmd of ["command:new", "command:reset", "command:stop"]) {
    api.registerHook(cmd, async (event: any) => {
      enqueue({
        eventType: "command",
        agentId: extractAgentId(event.sessionKey),
        sessionKey: event.sessionKey,
        action: cmd.split(":")[1],
      });
    }, { name: `monitor.${cmd}` });
  }

  for (const lifecycle of ["gateway_start", "gateway_stop"]) {
    api.registerHook(lifecycle, async () => {
      enqueue({ eventType: "lifecycle", action: lifecycle });
    }, { name: `monitor.${lifecycle}` });
  }
}

function extractAgentId(sessionKey: string | undefined): string | null {
  if (!sessionKey) return null;
  const parts = sessionKey.split(":");
  if (parts[0] !== "agent" || !parts[1]) return null;
  return parts[1];
}

function findPendingToolCall(map: Map<string, string>, sessionKey: string): string | undefined {
  for (const [key, id] of map) {
    if (key.startsWith(`${sessionKey}:`)) {
      map.delete(key);
      return id;
    }
  }
  return undefined;
}
