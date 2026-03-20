import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { createDb } from "./db.js";
import { registerIngestRoute } from "./ingest.js";
import { registerQueryRoutes } from "./routes.js";
import { createWsHandler } from "./ws.js";
import { startPolling, catchUp } from "./polling.js";
import { startRetention } from "./retention.js";
import { startTranscriptWatcher } from "./transcript-watcher.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const db = createDb(config.dbPath);
const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);
await app.register(fastifyCors, { origin: true });

const { broadcast, broadcastAgents, registerWsRoute } = createWsHandler(db);
registerWsRoute(app);
registerIngestRoute(app, db, { ingestToken: config.ingestToken, broadcast });
registerQueryRoutes(app, db);

// Static file serving (production build)
const clientDir = resolve(__dirname, "../client");
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, { root: clientDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      reply.status(404).send({ error: "Not found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

// Start background services
await catchUp(db, config);
startPolling(db, config, broadcastAgents);
startRetention(db, config.retentionDays);
startTranscriptWatcher(db, config.openclawHome, broadcast);

await app.listen({ port: config.port, host: config.host });
console.log(`OpenClaw Monitor running at http://${config.host}:${config.port}`);
