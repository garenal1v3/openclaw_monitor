import "dotenv/config";
import { join } from "path";
import { homedir } from "os";

export const config = {
  port: parseInt(process.env.MONITOR_PORT || "3800", 10),
  host: process.env.MONITOR_HOST || "127.0.0.1",
  ingestToken: process.env.MONITOR_INGEST_TOKEN || "",
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789",
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  retentionDays: parseInt(process.env.RETENTION_DAYS || "7", 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
  dbPath: process.env.MONITOR_DB_PATH || "monitor.db",
  openclawHome: process.env.OPENCLAW_HOME || join(homedir(), ".openclaw"),
};
