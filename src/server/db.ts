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
    agent_id        TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'unknown',
    model           TEXT,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    context_tokens  INTEGER NOT NULL DEFAULT 0,
    session_count   INTEGER NOT NULL DEFAULT 0,
    last_active_at  INTEGER,
    updated_at      INTEGER
);

CREATE TABLE IF NOT EXISTS metadata (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);
`;

export function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function insertEvent(db: Db, event: MonitorEvent): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, timestamp, event_type, agent_id, session_key, from_agent, to_agent,
       content, tool_call_id, tool_name, tool_input, tool_output,
       model, input_tokens, output_tokens, metadata)
    VALUES
      (@id, @timestamp, @eventType, @agentId, @sessionKey, @fromAgent, @toAgent,
       @content, @toolCallId, @toolName, @toolInput, @toolOutput,
       @model, @inputTokens, @outputTokens, @metadata)
  `);
  const result = stmt.run(event);
  return result.changes > 0;
}

export interface GetEventsFilter {
  agent?: string;
  type?: string;
  since?: number;
  limit: number;
}

export function getEvents(db: Db, filter: GetEventsFilter): MonitorEvent[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.agent !== undefined) {
    conditions.push("agent_id = @agent");
    params.agent = filter.agent;
  }
  if (filter.type !== undefined) {
    conditions.push("event_type = @type");
    params.type = filter.type;
  }
  if (filter.since !== undefined) {
    conditions.push("timestamp > @since");
    params.since = filter.since;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.limit = filter.limit;

  const rows = db.prepare(`
    SELECT
      id,
      timestamp,
      event_type      AS eventType,
      agent_id        AS agentId,
      session_key     AS sessionKey,
      from_agent      AS fromAgent,
      to_agent        AS toAgent,
      content,
      tool_call_id    AS toolCallId,
      tool_name       AS toolName,
      tool_input      AS toolInput,
      tool_output     AS toolOutput,
      model,
      input_tokens    AS inputTokens,
      output_tokens   AS outputTokens,
      metadata
    FROM events
    ${where}
    ORDER BY timestamp DESC
    LIMIT @limit
  `).all(params);

  return rows as MonitorEvent[];
}

export function upsertAgent(db: Db, agent: AgentStatus): void {
  db.prepare(`
    INSERT INTO agents
      (agent_id, name, status, model, total_tokens, context_tokens,
       session_count, last_active_at, updated_at)
    VALUES
      (@agentId, @name, @status, @model, @totalTokens, @contextTokens,
       @sessionCount, @lastActiveAt, @updatedAt)
    ON CONFLICT(agent_id) DO UPDATE SET
      name           = excluded.name,
      status         = excluded.status,
      model          = excluded.model,
      total_tokens   = excluded.total_tokens,
      context_tokens = excluded.context_tokens,
      session_count  = excluded.session_count,
      last_active_at = excluded.last_active_at,
      updated_at     = excluded.updated_at
  `).run(agent);
}

export function getAgents(db: Db): AgentStatus[] {
  const rows = db.prepare(`
    SELECT
      agent_id        AS agentId,
      name,
      status,
      model,
      total_tokens    AS totalTokens,
      context_tokens  AS contextTokens,
      session_count   AS sessionCount,
      last_active_at  AS lastActiveAt,
      updated_at      AS updatedAt
    FROM agents
    ORDER BY last_active_at DESC NULLS LAST
  `).all();

  return rows as AgentStatus[];
}

export interface GetInteractionsFilter {
  since: number;
}

export function getInteractions(db: Db, filter: GetInteractionsFilter): Interaction[] {
  const rows = db.prepare(`
    SELECT
      agg.from_agent  AS fromAgent,
      agg.to_agent    AS toAgent,
      agg.count       AS count,
      agg.lastAt      AS lastAt,
      e.content       AS lastContent
    FROM (
      SELECT
        from_agent,
        to_agent,
        COUNT(*)       AS count,
        MAX(timestamp) AS lastAt
      FROM events
      WHERE from_agent IS NOT NULL
        AND to_agent   IS NOT NULL
        AND timestamp  > @since
      GROUP BY from_agent, to_agent
    ) agg
    JOIN events e
      ON e.from_agent = agg.from_agent
     AND e.to_agent   = agg.to_agent
     AND e.timestamp  = agg.lastAt
  `).all({ since: filter.since });

  return rows as Interaction[];
}

export function deleteOldEventsBatch(db: Db, olderThanTimestamp: number): number {
  const result = db.prepare(`
    DELETE FROM events
    WHERE id IN (
      SELECT id FROM events
      WHERE timestamp < @threshold
      LIMIT 1000
    )
  `).run({ threshold: olderThanTimestamp });

  return result.changes;
}

export function getMetadata(db: Db, key: string): string | undefined {
  const row = db.prepare(`
    SELECT value FROM metadata WHERE key = @key
  `).get({ key }) as { value: string } | undefined;

  return row?.value;
}

export function setMetadata(db: Db, key: string, value: string): void {
  db.prepare(`
    INSERT INTO metadata (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ key, value });
}
