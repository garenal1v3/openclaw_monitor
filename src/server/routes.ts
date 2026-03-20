import type { FastifyInstance } from "fastify";
import { getAgents, getEvents, getInteractions, type Db } from "./db.js";

export function registerQueryRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/agents", async (_req, reply) => {
    return reply.send(getAgents(db));
  });

  app.get("/api/events", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const limit = query.limit !== undefined ? parseInt(query.limit, 10) : 100;
    return reply.send(
      getEvents(db, {
        agent: query.agent,
        type: query.type,
        since: query.since !== undefined ? parseInt(query.since, 10) : undefined,
        limit,
      }),
    );
  });

  app.get("/api/interactions", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const since = query.since !== undefined ? parseInt(query.since, 10) : 0;
    return reply.send(getInteractions(db, { since }));
  });
}
