# OpenClaw Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted web dashboard for real-time monitoring of OpenClaw agents — interaction graph, timeline, message logs, tool calls, reasoning.

**Architecture:** OpenClaw Plugin pushes events via hooks to Fastify server, which stores them in SQLite and broadcasts via WebSocket to React SPA. Gateway HTTP API is polled for agent status. Two data sources, 100% official APIs.

**Tech Stack:** Node.js 20+, TypeScript, Fastify 5, better-sqlite3, React 19, Vite 6, Tailwind CSS 4, Cytoscape.js, vis-timeline

**Spec:** `docs/2026-03-20-openclaw-monitor-design.md`

**Working directory:** `/Users/nikita/Documents/homebrew/openclaw_monitor`

---

## File Structure

```
openclaw-monitor/
├── package.json                    # Root: scripts, dependencies
├── tsconfig.json                   # Base TS config
├── tsconfig.server.json            # Server TS config (Node target)
├── vite.config.ts                  # Vite: React build + proxy to server in dev
├── index.html                      # Vite entry
├── src/
│   ├── shared/
│   │   └── types.ts                # Event, Agent, WS message types
│   ├── server/
│   │   ├── index.ts                # Entry: create Fastify, register all, start
│   │   ├── config.ts               # Env config with defaults
│   │   ├── db.ts                   # SQLite: init schema, query functions
│   │   ├── ingest.ts               # POST /api/v1/ingest route
│   │   ├── normalize.ts            # Event normalization + agent_end processing
│   │   ├── routes.ts               # GET /api/agents, /api/events, /api/interactions
│   │   ├── ws.ts                   # WebSocket: connections, subscribe, broadcast
│   │   ├── polling.ts              # Gateway API sessions polling
│   │   └── retention.ts            # Periodic cleanup of old events
│   └── client/
│       ├── main.tsx                # React entry
│       ├── App.tsx                 # Router + layout
│       ├── hooks/
│       │   └── useMonitor.ts       # WebSocket connection + state store
│       ├── views/
│       │   ├── Dashboard.tsx       # Graph + EventFeed layout
│       │   ├── TimelinePage.tsx    # vis-timeline wrapper
│       │   └── LogPage.tsx         # MessageLog wrapper
│       └── components/
│           ├── AgentGraph.tsx       # Cytoscape.js graph
│           ├── EventFeed.tsx        # Live event list
│           ├── Timeline.tsx         # vis-timeline swim lanes
│           ├── MessageLog.tsx       # Filterable event table
│           └── AgentDetail.tsx      # Slide-out agent panel
├── test/
│   ├── db.test.ts
│   ├── ingest.test.ts
│   ├── normalize.test.ts
│   ├── routes.test.ts
│   └── ws.test.ts
├── plugin/                          # Separate npm package
│   ├── package.json
│   ├── index.ts
│   └── test/
│       └── index.test.ts
├── Dockerfile
└── docs/
    ├── 2026-03-20-openclaw-monitor-design.md
    └── 2026-03-20-openclaw-monitor-plan.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/shared/types.ts`
- Create: `src/server/config.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/nikita/Documents/homebrew/openclaw_monitor
npm init -y
```

Edit `package.json`:
```json
{
  "name": "openclaw-monitor",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
# Runtime
npm install fastify @fastify/websocket @fastify/static @fastify/cors better-sqlite3 ulid dotenv

# Dev
npm install -D typescript tsx vitest concurrently @types/better-sqlite3 @types/node

# Frontend
npm install react react-dom cytoscape vis-timeline vis-data moment
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom @types/cytoscape
```

- [ ] **Step 3: Create tsconfig.json (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create tsconfig.server.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src/server", "src/shared"]
}
```

- [ ] **Step 5: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src/shared") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3800",
      "/ws": { target: "ws://localhost:3800", ws: true },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
```

- [ ] **Step 6: Create index.html**

```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenClaw Monitor</title>
</head>
<body class="bg-gray-950 text-gray-100">
  <div id="root"></div>
  <script type="module" src="/src/client/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Create src/shared/types.ts**

Shared types used by both server and client:

```typescript
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

// WebSocket messages
export type WsClientMessage =
  | { type: "subscribe"; agents?: string[]; eventTypes?: string[] }
  | { type: "unsubscribe" };

export type WsServerMessage =
  | { type: "init"; data: { agents: AgentStatus[]; recentEvents: MonitorEvent[] } }
  | { type: "event"; data: MonitorEvent }
  | { type: "agents_update"; data: AgentStatus[] };

// Ingest payload from plugin
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
```

- [ ] **Step 8: Create src/server/config.ts**

```typescript
import "dotenv/config";

export const config = {
  port: parseInt(process.env.MONITOR_PORT || "3800", 10),
  host: process.env.MONITOR_HOST || "127.0.0.1",
  ingestToken: process.env.MONITOR_INGEST_TOKEN || "",
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789",
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  retentionDays: parseInt(process.env.RETENTION_DAYS || "7", 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
  dbPath: process.env.MONITOR_DB_PATH || "monitor.db",
};
```

- [ ] **Step 9: Create .gitignore**

```
node_modules/
dist/
*.db
.env
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript, Fastify, React, Vite"
```

---

### Task 2: SQLite Database Layer

**Files:**
- Create: `src/server/db.ts`
- Create: `test/db.test.ts`

- [ ] **Step 1: Write failing tests for DB**

```typescript
// test/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, insertEvent, getEvents, getAgents, upsertAgent, getInteractions, deleteOldEventsBatch, getMetadata, setMetadata, type Db } from "../src/server/db.js";
import type { MonitorEvent } from "../src/shared/types.js";

let db: Db;

beforeEach(() => { db = createDb(":memory:"); });
afterEach(() => { db.close(); });

describe("insertEvent + getEvents", () => {
  it("inserts and retrieves an event", () => {
    const event: MonitorEvent = {
      id: "01ABC", timestamp: 1000, eventType: "message_sent",
      agentId: "dev", sessionKey: "agent:dev:main",
      fromAgent: null, toAgent: "reviewer", content: "hello",
      toolCallId: null, toolName: null, toolInput: null, toolOutput: null,
      model: null, inputTokens: null, outputTokens: null, metadata: null,
    };
    insertEvent(db, event);
    const result = getEvents(db, { limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
  });

  it("filters by agentId", () => {
    insertEvent(db, { id: "1", timestamp: 1, eventType: "message_sent", agentId: "dev" } as MonitorEvent);
    insertEvent(db, { id: "2", timestamp: 2, eventType: "message_sent", agentId: "pm" } as MonitorEvent);
    expect(getEvents(db, { agent: "dev", limit: 10 })).toHaveLength(1);
  });

  it("filters by eventType", () => {
    insertEvent(db, { id: "1", timestamp: 1, eventType: "tool_call", agentId: "dev" } as MonitorEvent);
    insertEvent(db, { id: "2", timestamp: 2, eventType: "message_sent", agentId: "dev" } as MonitorEvent);
    expect(getEvents(db, { type: "tool_call", limit: 10 })).toHaveLength(1);
  });
});

describe("upsertAgent + getAgents", () => {
  it("inserts and retrieves agents", () => {
    upsertAgent(db, { agentId: "dev", name: "Developer", status: "active", model: "opus-4", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1000, updatedAt: 1000 });
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("dev");
    expect(agents[0].status).toBe("active");
  });

  it("upserts existing agent", () => {
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "idle", model: "opus", totalTokens: 0, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 2, updatedAt: 2 });
    const agents = getAgents(db);
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe("active");
    expect(agents[0].totalTokens).toBe(100);
  });
});

describe("deleteOldEventsBatch", () => {
  it("deletes events older than threshold", () => {
    insertEvent(db, { id: "1", timestamp: 100, eventType: "command", agentId: "dev" } as MonitorEvent);
    insertEvent(db, { id: "2", timestamp: 200, eventType: "command", agentId: "dev" } as MonitorEvent);
    insertEvent(db, { id: "3", timestamp: 300, eventType: "command", agentId: "dev" } as MonitorEvent);
    const deleted = deleteOldEventsBatch(db, 250);
    expect(deleted).toBe(2);
    expect(getEvents(db, { limit: 10 })).toHaveLength(1);
  });
});

describe("metadata", () => {
  it("sets and gets metadata", () => {
    setMetadata(db, "hwm:dev", "1000");
    expect(getMetadata(db, "hwm:dev")).toBe("1000");
  });

  it("upserts existing key", () => {
    setMetadata(db, "hwm:dev", "1000");
    setMetadata(db, "hwm:dev", "2000");
    expect(getMetadata(db, "hwm:dev")).toBe("2000");
  });

  it("returns undefined for missing key", () => {
    expect(getMetadata(db, "nonexistent")).toBeUndefined();
  });
});

describe("getInteractions", () => {
  it("aggregates agent-to-agent interactions", () => {
    insertEvent(db, { id: "1", timestamp: 100, eventType: "message_received", agentId: "dev", fromAgent: "pm", toAgent: "dev", content: "task 1" } as MonitorEvent);
    insertEvent(db, { id: "2", timestamp: 200, eventType: "message_received", agentId: "dev", fromAgent: "pm", toAgent: "dev", content: "task 2" } as MonitorEvent);
    insertEvent(db, { id: "3", timestamp: 300, eventType: "message_received", agentId: "reviewer", fromAgent: "dev", toAgent: "reviewer", content: "PR ready" } as MonitorEvent);

    const interactions = getInteractions(db, { since: 0 });
    expect(interactions).toHaveLength(2);

    const pmToDev = interactions.find(i => i.fromAgent === "pm" && i.toAgent === "dev");
    expect(pmToDev?.count).toBe(2);
    expect(pmToDev?.lastContent).toBe("task 2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/db.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement db.ts**

```typescript
// src/server/db.ts
import Database from "better-sqlite3";
import type { MonitorEvent, AgentStatus, Interaction } from "../shared/types.js";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    timestamp       INTEGER NOT NULL,
    event_type      TEXT NOT NULL,
    agent_id        TEXT,
    session_key     TEXT,
    from_agent      TEXT,
    to_agent        TEXT,
    content         TEXT,
    tool_call_id    TEXT,
    tool_name       TEXT,
    tool_input      TEXT,
    tool_output     TEXT,
    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    metadata        TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_interactions ON events(from_agent, to_agent, timestamp) WHERE from_agent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tool ON events(tool_call_id) WHERE tool_call_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(tool_call_id, event_type) WHERE tool_call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agents (
    agent_id       TEXT PRIMARY KEY,
    name           TEXT,
    status         TEXT DEFAULT 'unknown',
    model          TEXT,
    total_tokens   INTEGER DEFAULT 0,
    context_tokens INTEGER DEFAULT 0,
    session_count  INTEGER DEFAULT 0,
    last_active_at INTEGER,
    updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
`;

export function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

const INSERT_EVENT = `INSERT OR IGNORE INTO events (id, timestamp, event_type, agent_id, session_key, from_agent, to_agent, content, tool_call_id, tool_name, tool_input, tool_output, model, input_tokens, output_tokens, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Returns true if event was inserted, false if duplicate (dedup index). */
export function insertEvent(db: Db, e: MonitorEvent): boolean {
  const result = db.prepare(INSERT_EVENT).run(
    e.id, e.timestamp, e.eventType, e.agentId, e.sessionKey,
    e.fromAgent, e.toAgent, e.content,
    e.toolCallId, e.toolName, e.toolInput, e.toolOutput,
    e.model, e.inputTokens, e.outputTokens, e.metadata,
  );
  return result.changes > 0;
}

interface EventFilters {
  agent?: string;
  type?: string;
  since?: number;
  limit?: number;
}

const SELECT_EVENTS = `SELECT id, timestamp, event_type AS eventType, agent_id AS agentId, session_key AS sessionKey, from_agent AS fromAgent, to_agent AS toAgent, content, tool_call_id AS toolCallId, tool_name AS toolName, tool_input AS toolInput, tool_output AS toolOutput, model, input_tokens AS inputTokens, output_tokens AS outputTokens, metadata FROM events`;

export function getEvents(db: Db, filters: EventFilters): MonitorEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.agent) { conditions.push("agent_id = ?"); params.push(filters.agent); }
  if (filters.type) { conditions.push("event_type = ?"); params.push(filters.type); }
  if (filters.since) { conditions.push("timestamp > ?"); params.push(filters.since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 100;

  return db.prepare(`${SELECT_EVENTS} ${where} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit) as MonitorEvent[];
}

const SELECT_AGENTS = `SELECT agent_id AS agentId, name, status, model, total_tokens AS totalTokens, context_tokens AS contextTokens, session_count AS sessionCount, last_active_at AS lastActiveAt, updated_at AS updatedAt FROM agents`;

export function getAgents(db: Db): AgentStatus[] {
  return db.prepare(`${SELECT_AGENTS} ORDER BY agent_id`).all() as AgentStatus[];
}

export function getMetadata(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMetadata(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function upsertAgent(db: Db, a: AgentStatus): void {
  db.prepare(`INSERT INTO agents (agent_id, name, status, model, total_tokens, context_tokens, session_count, last_active_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET name=excluded.name, status=excluded.status, model=excluded.model, total_tokens=excluded.total_tokens, context_tokens=excluded.context_tokens, session_count=excluded.session_count, last_active_at=excluded.last_active_at, updated_at=excluded.updated_at`).run(a.agentId, a.name, a.status, a.model, a.totalTokens, a.contextTokens, a.sessionCount, a.lastActiveAt, a.updatedAt);
}

export function getInteractions(db: Db, filters: { since?: number }): Interaction[] {
  const since = filters.since || 0;
  return db.prepare(`SELECT from_agent AS fromAgent, to_agent AS toAgent, COUNT(*) AS count, MAX(timestamp) AS lastAt, (SELECT content FROM events e2 WHERE e2.from_agent = events.from_agent AND e2.to_agent = events.to_agent ORDER BY e2.timestamp DESC LIMIT 1) AS lastContent FROM events WHERE from_agent IS NOT NULL AND timestamp > ? GROUP BY from_agent, to_agent ORDER BY lastAt DESC`).all(since) as Interaction[];
}

/** Deletes one batch of old events. Returns number deleted. Caller should loop with async pauses. */
export function deleteOldEventsBatch(db: Db, beforeTimestamp: number, batchSize: number = 1000): number {
  const result = db.prepare("DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE timestamp < ? LIMIT ?)").run(beforeTimestamp, batchSize);
  return result.changes;
}
```

Note: column names in SQLite are snake_case. The `getEvents` and `getInteractions` queries return objects whose keys match the SQL column aliases. The `MonitorEvent` type uses camelCase. In implementation, add column alias mapping (`event_type AS eventType`, etc.) in SELECT statements, or use a mapper function. For now the tests use the actual DB column format. Align during implementation.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/db.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db.ts test/db.test.ts
git commit -m "feat: add SQLite database layer with schema and query functions"
```

---

### Task 3: Event Normalization

**Files:**
- Create: `src/server/normalize.ts`
- Create: `test/normalize.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeIngestEvent, normalizeAgentEnd } from "../src/server/normalize.js";

describe("normalizeIngestEvent", () => {
  it("normalizes message_received event", () => {
    const result = normalizeIngestEvent({
      eventType: "message_received",
      timestamp: 1000,
      agentId: "dev",
      sessionKey: "agent:dev:main",
      from: "pm",
      content: "hello",
    });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("message_received");
    expect(result[0].fromAgent).toBe("pm");
    expect(result[0].agentId).toBe("dev");
    expect(result[0].id).toBeTruthy();
  });

  it("normalizes tool_call with toolCallId", () => {
    const result = normalizeIngestEvent({
      eventType: "tool_call",
      timestamp: 1000,
      agentId: "dev",
      toolCallId: "tc-123",
      toolName: "exec",
      toolInput: { command: "ls" },
    });
    expect(result[0].toolCallId).toBe("tc-123");
    expect(result[0].toolName).toBe("exec");
    expect(result[0].toolInput).toBe('{"command":"ls"}');
  });

  it("normalizes command event", () => {
    const result = normalizeIngestEvent({
      eventType: "command",
      timestamp: 1000,
      agentId: "dev",
      action: "new",
    });
    expect(result[0].eventType).toBe("command");
    expect(result[0].content).toBe("new");
  });
});

describe("normalizeAgentEnd", () => {
  it("extracts thinking blocks as reasoning events", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end",
      timestamp: 1000,
      agentId: "dev",
      sessionKey: "agent:dev:main",
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "I need to check the tests" },
          { type: "text", text: "Tests pass." },
        ]},
      ],
      metadata: { inputTokens: 500, outputTokens: 200 },
    });

    const reasoning = result.filter(e => e.eventType === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].content).toBe("I need to check the tests");
  });

  it("includes token counts in last event", () => {
    const result = normalizeAgentEnd({
      eventType: "agent_end",
      timestamp: 1000,
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
      eventType: "agent_end",
      timestamp: 1000,
      agentId: "dev",
      messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
      metadata: {},
    });
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/normalize.test.ts
```

- [ ] **Step 3: Implement normalize.ts**

```typescript
// src/server/normalize.ts
import { ulid } from "ulid";
import type { MonitorEvent, IngestEvent } from "../shared/types.js";

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
    toolInput: raw.toolInput ? JSON.stringify(raw.toolInput) : null,
    toolOutput: raw.toolOutput ? JSON.stringify(raw.toolOutput) : null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    metadata: raw.provenance ? JSON.stringify(raw.provenance) : null,
  };

  return [event];
}

export function normalizeAgentEnd(raw: IngestEvent): MonitorEvent[] {
  const events: MonitorEvent[] = [];
  const messages = raw.messages as Array<{ role: string; content: Array<{ type: string; thinking?: string; text?: string }> }> | undefined;
  if (!messages) return events;

  const meta = raw.metadata as Record<string, unknown> | undefined;

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "thinking" && block.thinking) {
        events.push({
          id: ulid(raw.timestamp),
          timestamp: raw.timestamp,
          eventType: "reasoning",
          agentId: raw.agentId ?? null,
          sessionKey: raw.sessionKey ?? null,
          fromAgent: null, toAgent: null,
          content: block.thinking,
          toolCallId: null, toolName: null, toolInput: null, toolOutput: null,
          model: null, inputTokens: null, outputTokens: null, metadata: null,
        });
      }
    }
  }

  // Attach token counts to last event
  if (events.length > 0 && meta) {
    const last = events[events.length - 1];
    last.inputTokens = (meta.inputTokens as number) ?? null;
    last.outputTokens = (meta.outputTokens as number) ?? null;
  }

  return events;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/normalize.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/normalize.ts test/normalize.test.ts
git commit -m "feat: add event normalization with agent_end thinking extraction"
```

---

### Task 4: Ingest Endpoint

**Files:**
- Create: `src/server/ingest.ts`
- Create: `test/ingest.test.ts`

- [ ] **Step 1: Write failing tests**

Test the Fastify route: POST /api/v1/ingest with auth, single event, batch.

```typescript
// test/ingest.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerIngestRoute } from "../src/server/ingest.js";
import { createDb, getEvents, type Db } from "../src/server/db.js";

let db: Db;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  db = createDb(":memory:");
  app = Fastify();
  registerIngestRoute(app, db, { ingestToken: "secret", broadcast: () => {} });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("POST /api/v1/ingest", () => {
  it("rejects without auth token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/ingest", payload: { eventType: "message_sent", timestamp: 1000, agentId: "dev" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts single event with valid token", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingest",
      headers: { authorization: "Bearer secret" },
      payload: { eventType: "message_sent", timestamp: 1000, agentId: "dev", content: "hello" },
    });
    expect(res.statusCode).toBe(200);
    expect(getEvents(db, { limit: 10 })).toHaveLength(1);
  });

  it("accepts batch of events", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingest",
      headers: { authorization: "Bearer secret" },
      payload: [
        { eventType: "message_sent", timestamp: 1000, agentId: "dev", content: "one" },
        { eventType: "tool_call", timestamp: 1001, agentId: "dev", toolName: "exec" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(getEvents(db, { limit: 10 })).toHaveLength(2);
  });

  it("skips auth when token is empty", async () => {
    const app2 = Fastify();
    registerIngestRoute(app2, db, { ingestToken: "", broadcast: () => {} });
    await app2.ready();
    const res = await app2.inject({ method: "POST", url: "/api/v1/ingest", payload: { eventType: "command", timestamp: 1, agentId: "dev", action: "new" } });
    expect(res.statusCode).toBe(200);
    await app2.close();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run test/ingest.test.ts
```

- [ ] **Step 3: Implement ingest.ts**

```typescript
// src/server/ingest.ts
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { IngestEvent, MonitorEvent } from "../shared/types.js";
import { normalizeIngestEvent } from "./normalize.js";
import { insertEvent } from "./db.js";

interface IngestOptions {
  ingestToken: string;
  broadcast: (event: MonitorEvent) => void;
}

export function registerIngestRoute(app: FastifyInstance, db: Db, opts: IngestOptions) {
  app.post("/api/v1/ingest", async (request, reply) => {
    // Auth check
    if (opts.ingestToken) {
      const auth = request.headers.authorization;
      if (auth !== `Bearer ${opts.ingestToken}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }

    const body = request.body as IngestEvent | IngestEvent[];
    const events = Array.isArray(body) ? body : [body];

    const inserted: MonitorEvent[] = [];
    for (const raw of events) {
      const normalized = normalizeIngestEvent(raw);
      for (const event of normalized) {
        // INSERT OR IGNORE handles dedup via unique index on (tool_call_id, event_type)
        const changed = insertEvent(db, event);
        if (changed) inserted.push(event);
      }
    }

    for (const event of inserted) {
      opts.broadcast(event);
    }

    return { ok: true, count: inserted.length };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/ingest.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest.ts test/ingest.test.ts
git commit -m "feat: add ingest endpoint with auth and batch support"
```

---

### Task 5: Query Routes

**Files:**
- Create: `src/server/routes.ts`
- Create: `test/routes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerQueryRoutes } from "../src/server/routes.js";
import { createDb, insertEvent, upsertAgent, type Db } from "../src/server/db.js";

let db: Db;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  db = createDb(":memory:");
  app = Fastify();
  registerQueryRoutes(app, db);
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

describe("GET /api/agents", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns agents after upsert", async () => {
    upsertAgent(db, { agentId: "dev", name: "Developer", status: "active", model: "opus", totalTokens: 100, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].agentId).toBe("dev");
  });
});

describe("GET /api/events", () => {
  it("returns events with camelCase keys", async () => {
    insertEvent(db, { id: "1", timestamp: 1000, eventType: "message_sent", agentId: "dev", sessionKey: "agent:dev:main", fromAgent: null, toAgent: "rev", content: "hi", toolCallId: null, toolName: null, toolInput: null, toolOutput: null, model: null, inputTokens: null, outputTokens: null, metadata: null });
    const res = await app.inject({ method: "GET", url: "/api/events?limit=10" });
    const events = res.json();
    expect(events[0].eventType).toBe("message_sent");
    expect(events[0].agentId).toBe("dev");
  });

  it("filters by agent query param", async () => {
    insertEvent(db, { id: "1", timestamp: 1, eventType: "command", agentId: "dev" } as any);
    insertEvent(db, { id: "2", timestamp: 2, eventType: "command", agentId: "pm" } as any);
    const res = await app.inject({ method: "GET", url: "/api/events?agent=dev&limit=10" });
    expect(res.json()).toHaveLength(1);
  });
});

describe("GET /api/interactions", () => {
  it("returns aggregated interactions", async () => {
    insertEvent(db, { id: "1", timestamp: 100, eventType: "message_received", agentId: "dev", fromAgent: "pm", toAgent: "dev", content: "task" } as any);
    const res = await app.inject({ method: "GET", url: "/api/interactions?since=0" });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].fromAgent).toBe("pm");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement routes.ts**

```typescript
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { getAgents, getEvents, getInteractions } from "./db.js";

export function registerQueryRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/agents", async () => getAgents(db));

  app.get("/api/events", async (request) => {
    const q = request.query as Record<string, string>;
    return getEvents(db, {
      agent: q.agent,
      type: q.type,
      since: q.since ? parseInt(q.since, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
    });
  });

  app.get("/api/interactions", async (request) => {
    const q = request.query as Record<string, string>;
    return getInteractions(db, { since: q.since ? parseInt(q.since, 10) : 0 });
  });
}
```

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add query routes for agents, events, and interactions"
```

---

### Task 6: WebSocket Handler

**Files:**
- Create: `src/server/ws.ts`
- Create: `test/ws.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/ws.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { createWsHandler } from "../src/server/ws.js";
import { createDb, insertEvent, upsertAgent, type Db } from "../src/server/db.js";

let db: Db;
let app: ReturnType<typeof Fastify>;
let port: number;

beforeEach(async () => {
  db = createDb(":memory:");
  app = Fastify();
  await app.register(fastifyWebsocket);
  const { broadcast, broadcastAgents, registerWsRoute } = createWsHandler(db);
  registerWsRoute(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as any).port;
});
afterEach(async () => { await app.close(); db.close(); });

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("WebSocket", () => {
  it("sends init message on connect with agents and recent events", async () => {
    upsertAgent(db, { agentId: "dev", name: "Dev", status: "active", model: "opus", totalTokens: 0, contextTokens: 200000, sessionCount: 1, lastActiveAt: 1, updatedAt: 1 });
    const ws = await connect();
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("init");
    expect(msg.data.agents).toHaveLength(1);
    expect(Array.isArray(msg.data.recentEvents)).toBe(true);
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement ws.ts**

```typescript
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Db } from "./db.js";
import type { MonitorEvent, AgentStatus, WsClientMessage, WsServerMessage } from "../shared/types.js";
import { getAgents, getEvents } from "./db.js";

interface Client {
  ws: WebSocket;
  filters: { agents?: string[]; eventTypes?: string[] } | null;
}

export function createWsHandler(db: Db) {
  const clients = new Set<Client>();

  function broadcast(event: MonitorEvent) {
    const msg = JSON.stringify({ type: "event", data: event } satisfies WsServerMessage);
    for (const client of clients) {
      if (!matchesFilters(client.filters, event)) continue;
      if (client.ws.readyState === 1) client.ws.send(msg);
    }
  }

  function broadcastAgents(agents: AgentStatus[]) {
    const msg = JSON.stringify({ type: "agents_update", data: agents } satisfies WsServerMessage);
    for (const client of clients) {
      if (client.ws.readyState === 1) client.ws.send(msg);
    }
  }

  function registerWsRoute(app: FastifyInstance) {
    app.get("/ws", { websocket: true }, (socket) => {
      const client: Client = { ws: socket, filters: null };
      clients.add(client);

      // Send init
      const init: WsServerMessage = {
        type: "init",
        data: { agents: getAgents(db), recentEvents: getEvents(db, { limit: 50 }) },
      };
      socket.send(JSON.stringify(init));

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsClientMessage;
          if (msg.type === "subscribe") {
            client.filters = { agents: msg.agents, eventTypes: msg.eventTypes };
          } else if (msg.type === "unsubscribe") {
            client.filters = null;
          }
        } catch {}
      });

      socket.on("close", () => clients.delete(client));
    });
  }

  return { broadcast, broadcastAgents, registerWsRoute };
}

function matchesFilters(filters: Client["filters"], event: MonitorEvent): boolean {
  if (!filters) return true;
  if (filters.agents?.length && event.agentId && !filters.agents.includes(event.agentId)) return false;
  if (filters.eventTypes?.length && !filters.eventTypes.includes(event.eventType)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add WebSocket handler with subscribe filters and broadcast"
```

---

### Task 7: Sessions Polling

**Files:**
- Create: `src/server/polling.ts`
- Create: `test/polling.test.ts`

- [ ] **Step 1: Write failing tests**

Mock the Gateway API fetch call. Test that polling parses session data and calls `upsertAgent` correctly. Test status classification: active (updatedAt within 5 min) vs idle.

- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement polling.ts**

Key logic:
- `startPolling(db, config, broadcastAgents)` → `setInterval` every `pollIntervalMs`
- Each tick: `fetch(gatewayUrl/tools/invoke, { tool: "sessions_list", args: { activeMinutes: 120 } })`
- Parse response, extract agentId from session keys
- Determine status: `updatedAt` within 5 min → active, else idle
- `upsertAgent` for each, then `broadcastAgents(getAgents(db))`

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add Gateway API sessions polling"
```

---

### Task 7b: Catch-Up on Startup

**Files:**
- Modify: `src/server/polling.ts`
- Modify: `test/polling.test.ts`

- [ ] **Step 1: Write failing test for catchUp**

```typescript
describe("catchUp", () => {
  it("fetches sessions_history and ingests events after high_water_mark", async () => {
    setMetadata(db, "hwm:dev", "500");
    // Mock Gateway API to return sessions_history with events at timestamps 400, 600, 700
    // Only 600 and 700 should be ingested
    await catchUp(db, mockConfig);
    expect(getEvents(db, { agent: "dev", limit: 10 })).toHaveLength(2);
    expect(getMetadata(db, "hwm:dev")).toBe("700");
  });

  it("ingests all events when no high_water_mark exists", async () => {
    await catchUp(db, mockConfig);
    // All events from sessions_history should be ingested
  });
});
```

- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement catchUp in polling.ts**

```typescript
export async function catchUp(db: Db, config: Config): Promise<void> {
  // 1. Get list of active sessions
  const sessions = await fetchSessionsList(config);
  for (const session of sessions) {
    const agentId = extractAgentIdFromKey(session.key);
    if (!agentId) continue;
    const hwmKey = `hwm:${agentId}`;
    const hwm = parseInt(getMetadata(db, hwmKey) || "0", 10);

    // 2. Fetch history for each session
    const history = await fetchSessionHistory(config, session.key);
    let maxTimestamp = hwm;

    for (const msg of history.messages) {
      if (msg.timestamp <= hwm) continue;
      // Normalize and insert (dedup index prevents duplicates)
      const events = normalizeHistoryMessage(msg, agentId, session.key);
      for (const event of events) {
        insertEvent(db, event);
      }
      if (msg.timestamp > maxTimestamp) maxTimestamp = msg.timestamp;
    }

    if (maxTimestamp > hwm) setMetadata(db, hwmKey, String(maxTimestamp));
  }
}
```

- [ ] **Step 4: Wire into index.ts — run `catchUp(db, config)` before `startPolling`**
- [ ] **Step 5: Run tests — PASS**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add catch-up mechanism with high_water_mark for startup recovery"
```

---

### Task 8: Retention Cleanup

**Files:**
- Create: `src/server/retention.ts`

- [ ] **Step 1: Implement retention.ts**

```typescript
import { deleteOldEventsBatch, type Db } from "./db.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runCleanup(db: Db, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400000;
  let total = 0;
  while (true) {
    const deleted = deleteOldEventsBatch(db, cutoff);
    total += deleted;
    if (deleted < 1000) break;
    await sleep(50); // yield to avoid blocking WAL
  }
  return total;
}

export function startRetention(db: Db, retentionDays: number): void {
  setInterval(() => runCleanup(db, retentionDays), 3600000); // every hour
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add periodic event retention cleanup"
```

---

### Task 9: Server Entry Point

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Implement index.ts**

Wire everything together:
```typescript
// Pseudo:
const db = createDb(config.dbPath);
const app = Fastify();
app.register(fastifyWebsocket);
app.register(fastifyCors, { origin: true });

const { broadcast, broadcastAgents, registerWsRoute } = createWsHandler(db);
registerWsRoute(app);
registerIngestRoute(app, db, { ingestToken: config.ingestToken, broadcast });
registerQueryRoutes(app, db);

// Static files (production)
if (existsSync("dist/client")) {
  app.register(fastifyStatic, { root: resolve("dist/client") });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => reply.sendFile("index.html"));
}

startPolling(db, config, broadcastAgents);
startRetention(db, config);

await app.listen({ port: config.port, host: config.host });
```

- [ ] **Step 2: Test manually**

```bash
npx tsx src/server/index.ts
# Should start on port 3800
curl http://localhost:3800/api/agents
# Should return []
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add server entry point wiring all components"
```

---

### Task 10: OpenClaw Plugin

**Files:**
- Create: `plugin/package.json`
- Create: `plugin/index.ts`
- Create: `plugin/test/index.test.ts`

- [ ] **Step 1: Create plugin/package.json**

```json
{
  "name": "openclaw-monitor-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "description": "OpenClaw plugin that sends agent events to openclaw-monitor dashboard"
}
```

- [ ] **Step 2: Write failing tests for extractAgentId and enqueue logic**

- [ ] **Step 3: Implement plugin/index.ts**

Copy the plugin code from the spec (with batch buffer, tool call correlation, extractAgentId). See spec lines 314-453. Additionally, register gateway lifecycle hooks not in spec:

```typescript
for (const lifecycle of ["gateway_start", "gateway_stop"]) {
  api.registerHook(lifecycle, async () => {
    enqueue({ eventType: "lifecycle", action: lifecycle });
  }, { name: `monitor.${lifecycle}` });
}
```

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add OpenClaw plugin with batch ingestion and tool call correlation"
```

---

### Task 11: React App Shell

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/main.css`

- [ ] **Step 1: Create main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./main.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
```

- [ ] **Step 2: Create main.css with Tailwind import**

```css
@import "tailwindcss";
```

- [ ] **Step 3: Create App.tsx with routing**

Simple hash-based routing (no react-router dependency):
- `#/` → Dashboard
- `#/timeline` → Timeline
- `#/log` → Message Log

Navigation bar at top with links.

- [ ] **Step 4: Verify dev server works**

```bash
npm run dev:client
# Open http://localhost:5173 — should show dark-themed shell with navigation
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add React app shell with routing and Tailwind dark theme"
```

---

### Task 12: WebSocket Hook + State

**Files:**
- Create: `src/client/hooks/useMonitor.ts`

- [ ] **Step 1: Implement useMonitor.ts**

Custom React hook that:
- Connects to `ws://host/ws` (auto-detect from window.location)
- Reconnects with exponential backoff (1s → 2s → 4s → max 30s)
- Parses `init`, `event`, `agents_update` messages
- Exposes state: `agents: AgentStatus[]`, `events: MonitorEvent[]`, `connected: boolean`
- Keeps last 200 events in memory (circular buffer)
- Functions: `subscribe(filters)`, `unsubscribe()`

- [ ] **Step 2: Verify connection works with running server**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add useMonitor hook with WebSocket and state management"
```

---

### Task 13: Dashboard — Agent Graph

**Files:**
- Create: `src/client/components/AgentGraph.tsx`
- Create: `src/client/views/Dashboard.tsx`

- [ ] **Step 1: Implement AgentGraph.tsx**

Cytoscape.js component:
- `useRef` for container div
- `useEffect` to init cytoscape instance with `cose` layout
- Props: `agents: AgentStatus[]`, `interactions: Interaction[]`, `onSelectAgent`, `onSelectEdge`
- Nodes: id, label (name), color (green/gray by status), badge (token %)
- Edges: source, target, width (∝ count), label (count)
- Update nodes/edges imperatively when props change (no full re-render)
- Animate edge on new interaction (flash color)

- [ ] **Step 2: Implement Dashboard.tsx**

Two-panel layout:
- Left: `<AgentGraph />` (flex-grow)
- Right: `<EventFeed />` (w-96)
- Fetch interactions from `GET /api/interactions` on mount + refresh on new events

- [ ] **Step 3: Verify graph renders with mock data**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add agent interaction graph with Cytoscape.js"
```

---

### Task 14: Dashboard — Event Feed

**Files:**
- Create: `src/client/components/EventFeed.tsx`

- [ ] **Step 1: Implement EventFeed.tsx**

Vertical list of events from `useMonitor().events`:
- Each row: timestamp, emoji+agent, arrow+target (if message), content preview (truncated)
- Color by type: message=blue, tool=orange, reasoning=purple, command=gray
- Auto-scroll to top when new events arrive
- Filter dropdowns: agent, event type

- [ ] **Step 2: Verify with running server + plugin**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add live event feed component"
```

---

### Task 15: Timeline Page

**Files:**
- Create: `src/client/components/Timeline.tsx`
- Create: `src/client/views/TimelinePage.tsx`

- [ ] **Step 1: Implement Timeline.tsx**

vis-timeline wrapper:
- Groups = agents (one swim lane per agent)
- Items = events (dots for instant events, point type)
- Color-coded by event type
- Pan/zoom enabled
- Hover shows tooltip with content preview
- Click opens detail

- [ ] **Step 2: Implement TimelinePage.tsx** — fetches events from API, passes to Timeline
- [ ] **Step 3: Verify renders**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add timeline view with vis-timeline swim lanes"
```

---

### Task 16: Message Log Page

**Files:**
- Create: `src/client/components/MessageLog.tsx`
- Create: `src/client/views/LogPage.tsx`

- [ ] **Step 1: Implement MessageLog.tsx**

Table with columns: timestamp, from → to, type, content preview.
- Expandable rows (click to show full content, tool I/O, reasoning)
- Filter bar: agent dropdown, event type dropdown, text search, date range
- Fetches from `GET /api/events` with query params
- Pagination via "Load more" button

- [ ] **Step 2: Implement LogPage.tsx**
- [ ] **Step 3: Verify renders**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add filterable message log page"
```

---

### Task 17: Agent Detail Panel

**Files:**
- Create: `src/client/components/AgentDetail.tsx`

- [ ] **Step 1: Implement AgentDetail.tsx**

Slide-out panel (right side overlay):
- Agent name, emoji, model, status badge
- Token usage gauge (total / context window, color: green < 60%, yellow < 80%, red ≥ 80%)
- Recent events list (last 20 for this agent)
- Mini interaction list: agents communicated with + count
- Props: `agentId: string`, `onClose`

- [ ] **Step 2: Wire into Dashboard — clicking graph node opens AgentDetail**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add agent detail slide-out panel"
```

---

### Task 18: Static Serving + Production Build

**Files:**
- Modify: `src/server/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Verify production build**

```bash
npm run build
npm run start
# Open http://localhost:3800 — should serve React SPA from dist/client
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add production build with static file serving"
```

---

### Task 19: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create multi-stage Dockerfile**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
ENV MONITOR_HOST=0.0.0.0
EXPOSE 3800
CMD ["node", "dist/server/index.js"]
```

- [ ] **Step 2: Test Docker build**

```bash
docker build -t openclaw-monitor .
docker run -p 3800:3800 openclaw-monitor
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add Dockerfile for production deployment"
```

---

### Task 20: Integration Testing

- [ ] **Step 1: Deploy monitor to 192.168.1.33**
- [ ] **Step 2: Install plugin into OpenClaw**
- [ ] **Step 3: Verify events flow: trigger agent activity → check dashboard shows events**
- [ ] **Step 4: Verify graph: agents appear as nodes, messages create edges**
- [ ] **Step 5: Verify timeline: events appear on swim lanes**
- [ ] **Step 6: Commit any fixes**

```bash
git commit -m "fix: integration testing adjustments"
```
