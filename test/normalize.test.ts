import { describe, it, expect } from "vitest";
import { normalizeIngestEvent, normalizeAgentEnd } from "../src/server/normalize.js";

describe("normalizeIngestEvent", () => {
  it("normalizes message_received", () => {
    const result = normalizeIngestEvent({
      eventType: "message_received", timestamp: 1000,
      agentId: "dev", sessionKey: "agent:dev:main",
      from: "pm", content: "hello",
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("message_received");
    expect(result[0].fromAgent).toBe("pm");
    expect(result[0].agentId).toBe("dev");
    expect(result[0].id).toBeTruthy();
  });

  it("normalizes tool_call with JSON stringified input", () => {
    const result = normalizeIngestEvent({
      eventType: "tool_call", timestamp: 1000,
      agentId: "dev", toolCallId: "tc-123",
      toolName: "exec", toolInput: { command: "ls" },
    });
    expect(result[0].toolCallId).toBe("tc-123");
    expect(result[0].toolName).toBe("exec");
    expect(result[0].toolInput).toBe('{"command":"ls"}');
  });

  it("normalizes command event with action as content", () => {
    const result = normalizeIngestEvent({
      eventType: "command", timestamp: 1000,
      agentId: "dev", action: "new",
    });
    expect(result[0].eventType).toBe("command");
    expect(result[0].content).toBe("new");
  });

  it("normalizes tool_result", () => {
    const result = normalizeIngestEvent({
      eventType: "tool_result", timestamp: 1000,
      agentId: "dev", toolCallId: "tc-123",
      toolName: "exec", toolOutput: { stdout: "ok" },
    });
    expect(result[0].toolOutput).toBe('{"stdout":"ok"}');
    expect(result[0].toolCallId).toBe("tc-123");
  });

  it("normalizes lifecycle event", () => {
    const result = normalizeIngestEvent({
      eventType: "lifecycle", timestamp: 1000,
      action: "gateway_start",
    });
    expect(result[0].eventType).toBe("lifecycle");
    expect(result[0].agentId).toBeNull();
  });
});

describe("normalizeAgentEnd", () => {
  it("extracts thinking blocks as reasoning events", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end", timestamp: 1000,
      agentId: "dev", sessionKey: "agent:dev:main",
      messages: [{
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I need to check the tests" },
          { type: "text", text: "Tests pass." },
        ],
      }],
      metadata: { inputTokens: 500, outputTokens: 200 },
    });
    const reasoning = result.filter(e => e.eventType === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].content).toBe("I need to check the tests");
  });

  it("includes token counts in last event", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end", timestamp: 1000,
      agentId: "dev",
      messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] }],
      metadata: { inputTokens: 500, outputTokens: 200 },
    });
    const last = result[result.length - 1];
    expect(last.inputTokens).toBe(500);
    expect(last.outputTokens).toBe(200);
  });

  it("returns empty array when no thinking blocks", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end", timestamp: 1000,
      agentId: "dev",
      messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
      metadata: {},
    });
    expect(result).toHaveLength(0);
  });

  it("handles multiple thinking blocks across messages", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end", timestamp: 1000,
      agentId: "dev",
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "first" }] },
        { role: "user", content: [{ type: "text", text: "go on" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "second" }] },
      ],
      metadata: {},
    });
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("second");
  });

  it("skips non-assistant messages", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end", timestamp: 1000,
      agentId: "dev",
      messages: [{ role: "user", content: [{ type: "thinking", thinking: "not this" }] }],
      metadata: {},
    });
    expect(result).toHaveLength(0);
  });
});
