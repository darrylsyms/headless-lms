import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { genId } from "@headless-lms/core/shared/id";
import { PurchaseSyncWebhookJobsRepository } from "./purchase-sync-webhook-jobs.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("durable purchase webhook jobs", () => {
  let pool: pg.Pool;
  let jobs: PurchaseSyncWebhookJobsRepository;
  const org = genId("organization"), owner = genId("user");
  beforeAll(async () => {
    const u = new URL(url!);
    if (u.hostname !== "127.0.0.1" || u.port !== "8005" || u.pathname !== "/fretwise_lms") {throw new Error("Local test database required.");}
    pool = new pg.Pool({ connectionString: url }); jobs = new PurchaseSyncWebhookJobsRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [owner, `${owner}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,$1,$1,$2)", [org, owner]);
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query("delete from purchase_sync_webhook_jobs where org_id=$1", [org]);
    await pool.query("delete from organizations where id=$1", [org]);
    await pool.query("delete from users where id=$1", [owner]); await pool.end();
  });
  it("deduplicates, leases exclusively, retries and survives an expired lease", async () => {
    const event = { deliveryId: "delivery-1", topic: "order.updated", resourceId: 42 };
    await jobs.enqueue(org, event); await jobs.enqueue(org, event);
    await expect(jobs.enqueue(org, { ...event, resourceId: 43 })).rejects.toThrow("conflict");
    const [first, other] = await Promise.all([jobs.claim(org), jobs.claim(org)]);
    const claimed = first ?? other;
    expect([first, other].filter(Boolean)).toHaveLength(1);
    expect(claimed?.attempts).toBe(1);
    expect(await jobs.retry(org, claimed!, 0)).toBe(true);
    const second = await jobs.claim(org); expect(second?.attempts).toBe(2);
    await pool.query("update purchase_sync_webhook_jobs set lease_until=now()-interval '1 second' where org_id=$1", [org]);
    expect(await jobs.complete(org, second!)).toBe(false);
    const third = await jobs.claim(org); expect(third?.attempts).toBe(3);
    expect(await jobs.complete(org, third!)).toBe(true);
    expect(await jobs.claim(org)).toBeNull();
  });
});
