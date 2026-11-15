import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { actorWith } from "@headless-lms/core/organizations";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { readStagingPurchases } from "../../../fretwise-lms-frontend/lib/server/staging-woo-reader.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { startWooSyncWorker } from "../../../fretwise-lms-frontend/lib/server/woocommerce-sync-worker.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
const existingId = "ent_3M5mpdySvjVKH2h0cKZEoz9TtoZ";
const bundleId = `bnd_worker_${randomBytes(12).toString("hex")}`;
const integrationId = "woocommerce-local-test";
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const db = drizzle(pool);
const path = `/${randomBytes(24).toString("hex")}`;
const rollback = new Error("rollback staging worker test");
let used = false;

async function run(credentials: { key: string; secret: string }) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`,
      );
      const grants = new DrizzleEntitlementsRepository(tx);
      const original = await grants.lockGrant(orgId, { orgUserId, contentId: courseId });
      assert.equal(original?.id, existingId);
      assert.equal(original?.source, "automation");
      assert.equal(original?.status, "revoked");
      assert.equal(await grants.hasAccess(orgId, orgUserId, courseId), false);
      await tx.execute(
        sql`delete from entitlements where org_id = ${orgId} and id = ${existingId}`,
      );
      await tx.execute(
        sql`insert into bundles (org_id, id, name) values (${orgId}, ${bundleId}, 'Temporary staging worker test')`,
      );
      await tx.execute(
        sql`insert into bundle_items (org_id, bundle_id, content_id) values (${orgId}, ${bundleId}, ${courseId})`,
      );
      const ledger = new PurchaseSyncLedgerRepository(tx);
      const service = new PurchaseSyncService({
        run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx) }),
      });
      const actor = actorWith({ id: "staging-worker-test", orgId, owner: true });
      const key = { orgId, orgUserId, integrationId };
      const store = createWooLmsStore({
        managesSubscription: true,
        ...key,
        courseId,
        bundleId,
        readLedger: () => ledger.get(key),
        commit: (input) => service.commit(input, actor),
        reportHeld: () => {
          throw new Error("A grant required review.");
        },
      });
      let count = 0;
      let resolveDone: (() => void) | undefined;
      let rejectDone: ((reason: unknown) => void) | undefined;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      const worker = startWooSyncWorker({
        intervalMs: 100,
        onError: (error) => rejectDone?.(error),
        reconcile: async () => {
          await reconcileWooPurchases({
            store,
            customerId: 23003226,
            courseProductId: 22049175,
            subscriptionProductId: 22049176,
            maxAgeMs: 300000,
            now: Date.now,
            readSnapshot: async () => {
              const data = await readStagingPurchases(credentials);
              assert.ok(
                data.orders.some((order) => order.id === 22049177 && order.status === "completed"),
              );
              assert.ok(
                data.subscriptions.some(
                  (subscription) =>
                    subscription.id === 22049178 && subscription.status === "cancelled",
                ),
              );
              return { ...data, capturedAt: Date.now() };
            },
          });
          assert.equal(await grants.hasAccess(orgId, orgUserId, courseId), true);
          assert.equal(
            (await grants.lockIntegrationGrant(orgId, { orgUserId, bundleId }))?.grant.status ??
              "absent",
            "absent",
          );
          if (++count === 2) {resolveDone?.();}
        },
      });
      try {
        await done;
      } finally {
        await worker.stop();
      }
      assert.equal((await ledger.get(key))?.revision, 2);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {throw error;}
  }
  const original = await new DrizzleEntitlementsRepository(db).lockGrant(orgId, {
    orgUserId,
    contentId: courseId,
  });
  assert.equal(original?.id, existingId);
  assert.equal(original?.source, "automation");
  assert.equal(original?.status, "revoked");
}

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.host !== "127.0.0.1:8015" || req.url !== path) {return res.writeHead(404).end();}
  if (req.method === "GET" && !used) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(
      '<h1>Temporary staging synchronization test</h1><p>Reads only the test customer and rolls back local access changes.</p><form method="post"><label>Read-only key <input type="password" name="key" required></label><label>Read-only secret <input type="password" name="secret" required></label><button>Run test</button></form>',
    );
  }
  if (req.method !== "POST" || req.headers.origin !== "http://127.0.0.1:8015" || used)
    {return res.writeHead(403).end();}
  used = true;
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) {throw new Error("Request too large.");}
    }
    const form = new URLSearchParams(body);
    await run({ key: form.get("key") ?? "", secret: form.get("secret") ?? "" });
    res.end(
      "PASS: two staging reads synchronized the test purchase; all local changes were rolled back.",
    );
  } catch {
    res.writeHead(500).end("Test failed. No local changes were committed.");
  } finally {
    server.close();
    await pool.end();
  }
});
server.listen(8015, "127.0.0.1", () =>
  process.stdout.write(`Temporary test: http://127.0.0.1:8015${path}\n`),
);
