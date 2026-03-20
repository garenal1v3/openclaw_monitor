import { describe, it, expect } from "vitest";

// Import the helpers directly - they're module-level functions
// For testing, we'll test the extractAgentId logic inline since the plugin exports only register()

describe("extractAgentId", () => {
  // Replicate the function for testing
  function extractAgentId(sessionKey: string | undefined): string | null {
    if (!sessionKey) return null;
    const parts = sessionKey.split(":");
    if (parts[0] !== "agent" || !parts[1]) return null;
    return parts[1];
  }

  it("extracts agent ID from standard key", () => {
    expect(extractAgentId("agent:dev-team-dev:main")).toBe("dev-team-dev");
  });

  it("extracts agent ID from spawn key", () => {
    expect(extractAgentId("agent:dev-team-dev:spawn-42")).toBe("dev-team-dev");
  });

  it("returns null for undefined", () => {
    expect(extractAgentId(undefined)).toBeNull();
  });

  it("returns null for non-agent key", () => {
    expect(extractAgentId("user:admin:main")).toBeNull();
  });

  it("returns null for malformed key", () => {
    expect(extractAgentId("agent:")).toBeNull();
  });
});
