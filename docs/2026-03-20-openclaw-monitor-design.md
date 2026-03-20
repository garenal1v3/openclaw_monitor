# OpenClaw Monitor — Design Specification

**Date:** 2026-03-20
**Status:** Draft
**Authors:** Nikita Davydov + Claude Opus 4.6

## Summary

Self-hosted веб-дашборд для мониторинга OpenClaw агентов в реальном времени. Показывает граф взаимодействий между агентами, таймлайн событий, полные логи сообщений, tool calls, reasoning — всё через официальные OpenClaw API (Plugin hooks + Gateway HTTP API).

Open-source проект, полезный для любого пользователя OpenClaw с multi-agent setup.

## Problem Statement

OpenClaw предоставляет базовый CLI-мониторинг (`openclaw status`, `openclaw sessions`), но для команды из 7+ агентов этого недостаточно:

1. **Нет визуализации взаимодействий** — непонятно кто кому писал и в каком порядке
2. **Нет live-обновлений** — нужно вручную запускать CLI команды
3. **Нет единого лога** — сообщения, tool calls и reasoning разбросаны по сессиям
4. **Нет графа** — невозможно увидеть общую картину коммуникаций
5. **Grafana не подходит** — заточена под инфраструктурные метрики, не под agent-to-agent взаимодействия

## Goals

- Real-time (или near real-time) мониторинг всех агентов в одном веб-интерфейсе
- Граф взаимодействий: кто кому пишет, частота, последнее сообщение
- Таймлайн: swim lanes по агентам, события на временной оси
- Полные логи: сообщения, tool calls (name + args + result), reasoning/thinking
- Статусы агентов: active/idle, использование токенов, модель
- Минимальная интеграция: только официальные API, без хаков

## Non-Goals

- Модификация поведения агентов (read-only мониторинг)
- Замена OpenClaw Control UI
- Алертинг (Phase 2)
- Стриминг reasoning в реальном времени (получаем при `agent_end`, не посимвольно)
- Multi-instance / distributed deployment

## Architecture

### High-Level

```
OpenClaw Gateway (port 18789)
    │
    ├── Plugin hooks (push) ─────► Monitor Server (port 3800)
    │   message_received              │
    │   message_sent                  ├── SQLite (event storage)
    │   before_tool_call              ├── REST API (query)
    │   after_tool_call               └── WebSocket (live push)
    │   agent_end                          │
    │   command:*, gateway_*               ▼
    │                                React SPA (Vite)
    └── HTTP API (poll) ─────────►  ├── Agent Graph
        POST /tools/invoke           ├── Timeline
        sessions_list                ├── Message Log
                                     └── Agent Detail
```

### Два источника данных

**Источник 1 — OpenClaw Plugin** (push-based, внутри gateway process):

Плагин регистрирует hooks через официальный Plugin API (`api.registerHook`). При каждом событии POST'ит нормализованный payload на `http://localhost:3800/api/ingest`.

| Hook | Данные | Назначение |
|------|--------|------------|
| `message_received` | from, to, content, provenance, sessionKey | Входящие сообщения (включая agent-to-agent через `provenance.sourceSessionKey`) |
| `message_sent` | to, content, sessionKey | Исходящие сообщения |
| `before_tool_call` | tool name, arguments, sessionKey | Tool call перед выполнением |
| `after_tool_call` | tool name, result, sessionKey | Tool result после выполнения |
| `agent_end` | final message list (включая thinking blocks), metadata | Reasoning/thinking, финальный ответ |
| `command:new/reset/stop` | sessionKey, action | Lifecycle команды |
| `gateway_start/gateway_stop` | timestamp | Gateway lifecycle |

**Источник 2 — Gateway HTTP API** (polling, каждые 5 секунд):

Monitor вызывает Gateway HTTP API для актуального состояния агентов:

```bash
POST http://127.0.0.1:18789/tools/invoke
Authorization: Bearer <token>
Content-Type: application/json

{"tool": "sessions_list", "action": "json", "args": {"activeMinutes": 120}}
```

Даёт: session key, agent ID, model, tokens (total/context), updatedAt, kind.

При запуске/reconnect — `sessions_history` с `includeTools: true` для catch-up пропущенных событий.

### Почему именно эти источники

- **Plugin hooks** — единственный способ получить push-уведомления о событиях в реальном времени. Даёт message content, tool calls, reasoning.
- **Gateway HTTP API** — единственный официальный способ получить текущее состояние сессий (токены, модель, active/idle).
- **OTEL** — не нужен. Plugin hooks покрывают все нужные события с большей детализацией.
- **Session file tailing** — не нужен. Хак, внутренний формат может измениться. Plugin hooks + Gateway API дают всё то же самое через официальные API.

## Backend

### Tech Stack

- **Runtime:** Node.js 20+ (TypeScript)
- **HTTP Server:** Fastify 5.x
- **WebSocket:** @fastify/websocket
- **Database:** SQLite (better-sqlite3) в WAL mode
- **Static Files:** @fastify/static (сервит React SPA)

### Data Model (SQLite)

**events** — все события:

```sql
CREATE TABLE events (
    id              TEXT PRIMARY KEY,  -- ULID (сортируемый по времени)
    timestamp       INTEGER NOT NULL,  -- unix ms
    event_type      TEXT NOT NULL,     -- message_received, message_sent, tool_call, tool_result, reasoning, command, lifecycle
    agent_id        TEXT,              -- ID агента (из sessionKey), NULL для gateway events
    session_key     TEXT,

    -- Messages
    from_agent      TEXT,              -- для agent-to-agent (из provenance)
    to_agent        TEXT,
    content         TEXT,              -- текст сообщения

    -- Tool calls
    tool_call_id    TEXT,              -- связывает tool_call и tool_result в пару
    tool_name       TEXT,
    tool_input      TEXT,              -- JSON
    tool_output     TEXT,              -- JSON

    -- Model
    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,

    -- Flexible
    metadata        TEXT               -- JSON, всё остальное
);

CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_agent ON events(agent_id, timestamp);
CREATE INDEX idx_events_type ON events(event_type, timestamp);
CREATE INDEX idx_events_interactions ON events(from_agent, to_agent, timestamp) WHERE from_agent IS NOT NULL;
CREATE INDEX idx_events_tool ON events(tool_call_id) WHERE tool_call_id IS NOT NULL;
```

`agent_id` nullable: для `gateway_start`/`gateway_stop` событий нет агента, используется `NULL`.

`tool_call_id` связывает `tool_call` и `tool_result` события: OpenClaw передаёт tool invocation ID в `event.context` для обоих hooks (`before_tool_call`, `after_tool_call`). Если ID недоступен, plugin генерирует UUID в `before_tool_call` и хранит в Map по `sessionKey + toolName` для привязки в `after_tool_call`.

**agents** — текущее состояние (обновляется polling'ом):

```sql
CREATE TABLE agents (
    agent_id       TEXT PRIMARY KEY,
    name           TEXT,
    status         TEXT DEFAULT 'unknown',  -- active, idle, unknown
    model          TEXT,
    total_tokens   INTEGER DEFAULT 0,
    context_tokens INTEGER DEFAULT 0,
    session_count  INTEGER DEFAULT 0,
    last_active_at INTEGER,
    updated_at     INTEGER
);
```

**metadata** — служебная информация:

```sql
CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Хранит high_water_mark per agent для дедупликации при catch-up
```

**Retention:** 7 дней по умолчанию (`RETENTION_DAYS` env var). Cleanup батчами (DELETE ... LIMIT 1000 в цикле с паузой 50ms) чтобы не раздувать WAL.

### API

**Ingestion (от plugin):**
- `POST /api/v1/ingest` — приём событий от OpenClaw plugin. Принимает как одиночный объект, так и массив (для batch). Аутентификация через shared secret (`MONITOR_INGEST_TOKEN` env var, передаётся как `Authorization: Bearer <token>`). Сервер по умолчанию привязан к `127.0.0.1`; для Docker-сетей или внешнего доступа настраивается через `MONITOR_HOST`.

**Query (для фронтенда):**
- `GET /api/agents` — список агентов с текущим статусом
- `GET /api/events?agent=<id>&type=<type>&since=<timestamp>&limit=<n>` — события с фильтрами
- `GET /api/interactions?since=<timestamp>` — агрегация agent-to-agent связей для графа (from, to, count, last_at, last_content)

**WebSocket:**
- `ws://localhost:3800/ws` — live event stream
  - При подключении: push текущего состояния агентов
  - При новом событии: broadcast всем клиентам
  - Фильтры: `{ subscribe: { agents: ["dev-team-dev"], types: ["message_sent"] } }`

### Processing Pipeline

```
Plugin POST /api/v1/ingest (single or batch)
    → Validate bearer token
    → For each event:
        → Validate & normalize
        → Dedup check (skip if event with same tool_call_id + event_type exists)
        → INSERT into SQLite
        → Broadcast via WebSocket to all connected clients

Sessions polling (every 5s)
    → Call Gateway API /tools/invoke {sessions_list}
    → UPSERT into agents table
    → Broadcast agent status update via WebSocket

Catch-up on startup/reconnect
    → For each agent: read high_water_mark from metadata table
    → Call Gateway API sessions_history with includeTools: true
    → Ingest only events with timestamp > high_water_mark
    → Update high_water_mark
```

### Processing `agent_end`

`agent_end` payload содержит `messages` (финальный message list) и `metadata`. Нормализация:

1. Извлечь все блоки `type: "thinking"` из assistant messages → создать отдельный event `reasoning` для каждого, с `content` = thinking text
2. Извлечь `input_tokens` и `output_tokens` из `metadata` → сохранить в последнем event
3. НЕ создавать дублирующий `message_sent` event — финальный ответ уже захвачен hook'ом `message_sent`

### WebSocket Protocol

**Client → Server:**
```json
{ "type": "subscribe", "agents": ["dev-team-dev"], "eventTypes": ["message_sent"] }
{ "type": "unsubscribe" }
```
Без `subscribe` — получает все события. `subscribe` с пустыми массивами — получает все.

**Server → Client:**
```json
{ "type": "event", "data": { /* event object */ } }
{ "type": "agents_update", "data": [ /* agents array */ ] }
{ "type": "init", "data": { "agents": [...], "recentEvents": [...] } }
```

При подключении сервер отправляет `init` с текущим состоянием агентов и последними 50 событиями. Reconnect: клиент переподключается с экспоненциальным backoff (1s → 2s → 4s → max 30s).

## Frontend

### Tech Stack

- **Framework:** React 19 + Vite + TypeScript
- **Styling:** Tailwind CSS (тёмная тема)
- **Graph:** Cytoscape.js (force-directed layout, imperative API для real-time updates)
- **Timeline:** vis-timeline (swim lanes, horizontal time axis, pan/zoom)
- **Transport:** Нативный WebSocket (reconnect on disconnect)

### Views

#### 1. Dashboard (главная)

Две панели:

**Левая (~70%) — Agent Graph:**
- Узлы = агенты (emoji + имя + статус-цвет)
- Рёбра = коммуникации (толщина ∝ количество сообщений за выбранный период)
- Цвет узла: зелёный = active, серый = idle
- Бейдж: % использования контекста
- Анимация на ребре при новом сообщении
- Клик на узел → Agent Detail
- Клик на ребро → лог сообщений между парой

**Правая (~30%) — Live Event Feed:**
- Вертикальный список событий (новые сверху)
- Формат: `[12:34:05] 💻 Developer → 🔍 Reviewer: "PR #42 готов"`
- Цветовая кодировка: сообщения (синий), tool calls (оранжевый), reasoning (фиолетовый), commands (серый)
- Фильтр по агенту и типу

#### 2. Timeline (swim lanes)

- Горизонтальная ось = время
- Вертикальные дорожки = агенты
- События = точки/блоки на дорожке
- Стрелки между дорожками = agent-to-agent сообщения
- Zoom: минуты → часы → дни
- Hover → превью, клик → полный detail

#### 3. Message Log

- Таблица событий с фильтрами (агент, тип, текстовый поиск, временной диапазон)
- Строка: `timestamp | from → to | event_type | content preview`
- Раскрываемые строки: полный контент, tool input/output, reasoning
- Monospace для контента

#### 4. Agent Detail (slide-out)

- Имя, модель, статус, emoji
- Gauge токенов (used / context window)
- Последние события агента
- Мини-граф: с кем общался
- Текущая сессия: ID, age, cache %

## OpenClaw Plugin

### Структура

```
openclaw-monitor-plugin/
├── package.json
├── index.ts         # register(api) — регистрация всех hooks
└── README.md
```

### Регистрация hooks

```typescript
export default function register(api) {
  const MONITOR_URL = process.env.OPENCLAW_MONITOR_URL || "http://localhost:3800";
  const MONITOR_TOKEN = process.env.OPENCLAW_MONITOR_TOKEN || "";

  // --- Batch buffer: собираем события до 100ms или 10 штук, потом отправляем пачкой ---
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
      // fire-and-forget: не блокируем агента если monitor недоступен
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

  // --- Tool call correlation: Map для связи before/after ---
  const pendingToolCalls = new Map<string, string>(); // key → generated toolCallId

  // --- Hooks ---

  api.registerHook("message_received", async (event) => {
    enqueue({
      eventType: "message_received",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      from: extractAgentId(event.context?.provenance?.sourceSessionKey),
      content: event.context?.content,
      provenance: event.context?.provenance,
    });
  }, { name: "monitor.message_received" });

  api.registerHook("message_sent", async (event) => {
    enqueue({
      eventType: "message_sent",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      to: event.context?.to,
      content: event.context?.content,
    });
  }, { name: "monitor.message_sent" });

  api.registerHook("before_tool_call", async (event) => {
    // Используем ID из контекста если есть, иначе генерируем
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

  api.registerHook("after_tool_call", async (event) => {
    const toolCallId = event.context?.toolCallId
      || findPendingToolCall(pendingToolCalls, event.sessionKey, event.context?.toolName);

    enqueue({
      eventType: "tool_result",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      toolCallId,
      toolName: event.context?.toolName,
      toolOutput: event.context?.result,
    });
  }, { name: "monitor.after_tool_call" });

  api.registerHook("agent_end", async (event) => {
    enqueue({
      eventType: "agent_end",
      agentId: extractAgentId(event.sessionKey),
      sessionKey: event.sessionKey,
      messages: event.context?.messages,
      metadata: event.context?.metadata,
    });
  }, { name: "monitor.agent_end" });

  for (const cmd of ["command:new", "command:reset", "command:stop"]) {
    api.registerHook(cmd, async (event) => {
      enqueue({
        eventType: "command",
        agentId: extractAgentId(event.sessionKey),
        sessionKey: event.sessionKey,
        action: cmd.split(":")[1],
      });
    }, { name: `monitor.${cmd}` });
  }
}

function extractAgentId(sessionKey: string | undefined): string | null {
  // "agent:dev-team-dev:main" → "dev-team-dev"
  // "agent:dev-team-dev:spawn-42" → "dev-team-dev"
  // undefined / malformed → null
  if (!sessionKey) return null;
  const parts = sessionKey.split(":");
  if (parts[0] !== "agent" || !parts[1]) return null;
  return parts[1];
}

function findPendingToolCall(
  map: Map<string, string>,
  sessionKey: string,
  toolName: string,
): string | undefined {
  // Ищем последний pending tool call для данной сессии
  for (const [key, id] of map) {
    if (key.startsWith(`${sessionKey}:`)) {
      map.delete(key);
      return id;
    }
  }
  return undefined;
}
```

### Установка

```bash
openclaw plugins install openclaw-monitor-plugin
openclaw gateway restart
```

## Configuration

### Monitor Server

Env переменные:

```
MONITOR_PORT=3800                    # порт веб-интерфейса
MONITOR_HOST=127.0.0.1              # bind address (0.0.0.0 для Docker)
MONITOR_INGEST_TOKEN=<secret>        # shared secret для plugin → monitor auth
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789  # Gateway API
OPENCLAW_GATEWAY_TOKEN=<token>       # Bearer token для Gateway API
RETENTION_DAYS=7                     # хранить данные N дней
POLL_INTERVAL_MS=5000                # частота опроса sessions
```

### Plugin

Env переменные (на стороне OpenClaw):

```
OPENCLAW_MONITOR_URL=http://localhost:3800   # адрес monitor server
OPENCLAW_MONITOR_TOKEN=<secret>              # тот же shared secret
```

### Quick Start

```bash
# 1. Установить и запустить monitor server
npm install -g openclaw-monitor
openclaw-monitor start

# 2. Установить plugin в OpenClaw
openclaw plugins install openclaw-monitor-plugin
openclaw gateway restart

# 3. Открыть дашборд
open http://localhost:3800
```

Docker:
```bash
docker run -d -p 3800:3800 \
  -e MONITOR_HOST=0.0.0.0 \
  -e MONITOR_INGEST_TOKEN=<secret> \
  -e OPENCLAW_GATEWAY_URL=http://host.docker.internal:18789 \
  -e OPENCLAW_GATEWAY_TOKEN=<token> \
  openclaw-monitor
```

**Docker networking:** plugin работает внутри OpenClaw gateway на хосте. Если monitor в Docker — plugin должен обращаться по адресу хоста (не `localhost`). Настраивается через `OPENCLAW_MONITOR_URL` в env OpenClaw.

## Tech Stack Summary

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Backend runtime | Node.js + TypeScript | 20+ | Server |
| HTTP server | Fastify | 5.x | REST API + static files |
| WebSocket | @fastify/websocket | 11.x | Live updates |
| Database | better-sqlite3 | 12.x | Event storage (WAL mode) |
| Frontend framework | React + Vite | 19.x / 6.x | SPA |
| Styling | Tailwind CSS | 4.x | Dark theme |
| Graph visualization | Cytoscape.js | 3.33.x | Agent interaction graph |
| Timeline | vis-timeline | 8.5.x | Swim lane events |
| OpenClaw integration | Plugin API | - | Event hooks |

## Decisions Log

1. **Plugin + Gateway API вместо file tailing** — session transcript files содержат все данные, но их формат внутренний и может измениться. Plugin hooks + Gateway HTTP API — официальные, стабильные интерфейсы.
2. **Plugin + Gateway API вместо OTEL** — OTEL даёт метаданные (spans, metrics), но не контент сообщений и не tool call arguments. Plugin hooks дают всё.
3. **SQLite вместо PostgreSQL** — single-process приложение с объёмом ~100-1000 events/час. SQLite проще, zero-dependency, достаточно производителен.
4. **Cytoscape.js вместо D3.js** — специализирован под network visualization, imperative API для real-time, force-directed layout из коробки.
5. **vis-timeline несмотря на 9 peer deps** — единственная зрелая библиотека для swim lane timeline. Альтернатива (custom D3) — значительно больше работы.
6. **Fastify вместо Express** — быстрее JSON serialization (важно для частых WebSocket broadcasts), нативная поддержка TypeScript, активная разработка.
7. **Reasoning из agent_end (post-hoc)** — streaming reasoning через Embedded PI Session API возможен, но требует глубокой интеграции. Для мониторинга достаточно видеть thinking blocks после завершения хода.
