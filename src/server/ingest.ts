import type { FastifyInstance } from "fastify";
import type { MonitorEvent, IngestEvent } from "../shared/types.js";
import type { Db } from "./db.js";
import { insertEvent } from "./db.js";
import { normalizeIngestEvent } from "./normalize.js";

interface IngestOpts {
  ingestToken: string;
  broadcast: (event: MonitorEvent) => void;
}

export function registerIngestRoute(
  app: FastifyInstance,
  db: Db,
  opts: IngestOpts,
): void {
  app.post("/api/v1/ingest", async (request, reply) => {
    if (opts.ingestToken !== "") {
      const authHeader = request.headers["authorization"] ?? "";
      const expected = `Bearer ${opts.ingestToken}`;
      if (authHeader !== expected) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }

    const body = request.body as IngestEvent | IngestEvent[];
    const rawEvents: IngestEvent[] = Array.isArray(body) ? body : [body];

    const tobroadcast: MonitorEvent[] = [];

    for (const raw of rawEvents) {
      const normalized = normalizeIngestEvent(raw);
      for (const event of normalized) {
        const inserted = insertEvent(db, event);
        if (inserted) {
          tobroadcast.push(event);
        }
      }
    }

    for (const event of tobroadcast) {
      opts.broadcast(event);
    }

    return reply.send({ ok: true, count: tobroadcast.length });
  });
}
