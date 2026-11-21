import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { StagingWordPressDeletionQueue } from "./staging-wordpress-deletion-queue.js";
import { processStagingWordPressDeletion } from "./staging-wordpress-deletion-worker.js";
import { startStagingWordPressDeletionListener } from "../../../fretwise-lms-frontend/lib/server/wordpress-deletion-listener.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || process.env.FRETWISE_STAGING_DELETION_ENABLED !== "1" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Explicit local staging configuration is required.");
const secret = process.env.FRETWISE_STAGING_DELETION_SECRET ?? "";
if (Buffer.byteLength(secret) < 32) throw new Error("Staging deletion secret is required.");
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const allowedSubjects = new Set(["23003226", "23003227"]);
const pool = new pg.Pool({ connectionString: url.toString() });
const db = drizzle(pool);
const queue = new StagingWordPressDeletionQueue(db, issuer);
const listener = await startStagingWordPressDeletionListener({ secret, issuer, port: 8018, enqueue: async event => {
  if (!allowedSubjects.has(event.subject)) throw new Error("Event not permitted in staging.");
  await queue.enqueue(event);
} });
let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 20; i++) {
      const job = await queue.claim();
      if (!job) return;
      try { await processStagingWordPressDeletion(db, job, { issuer, providerId: "fretwise-wordpress-staging", allowedSubjects }); }
      catch { await queue.retry(job); process.stderr.write("Deletion requires retry or review.\n"); }
    }
  } finally { running = false; }
}
const timer = setInterval(() => { void run().catch(() => process.stderr.write("Deletion queue unavailable.\n")); }, 5000);
void run().catch(() => process.stderr.write("Deletion queue unavailable.\n"));
async function stop() { clearInterval(timer); await listener.close(); while (running) await new Promise(resolve => setTimeout(resolve, 50)); await pool.end(); }
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
