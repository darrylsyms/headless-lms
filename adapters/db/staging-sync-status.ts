import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { PurchaseSyncFailuresRepository } from "./src/repositories/purchase-sync-failures.js";
import { PurchaseSyncHealthRepository } from "./src/repositories/purchase-sync-health.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
const pool = new pg.Pool({connectionString: url.toString()});
try {
  const db = drizzle(pool), orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
  const health = await new PurchaseSyncHealthRepository(db).get(orgId, "woocommerce-local-test");
  process.stdout.write(`Staging sync health: ${health}\n`);
  const failures = await new PurchaseSyncFailuresRepository(db).list(orgId);
  if (!failures.length) {process.stdout.write("No outstanding staging synchronization failures.\n");}
  for (const failure of failures) {process.stdout.write(`${failure.orgUserId} ${failure.target} attempts=${failure.attempts} last=${failure.lastFailedAt.toISOString()}\n`);}
} finally {await pool.end();}
