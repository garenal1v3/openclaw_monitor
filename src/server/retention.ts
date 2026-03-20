import { deleteOldEventsBatch, type Db } from "./db.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runCleanup(db: Db, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400000;
  let total = 0;
  while (true) {
    const deleted = deleteOldEventsBatch(db, cutoff);
    total += deleted;
    if (deleted < 1000) break;
    await sleep(50);
  }
  return total;
}

export function startRetention(db: Db, retentionDays: number): NodeJS.Timeout {
  return setInterval(() => runCleanup(db, retentionDays), 3600000);
}
