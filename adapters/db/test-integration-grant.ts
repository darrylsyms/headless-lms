import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { entitlementEvents } from "@headless-lms/core/entitlements";
import { actorWith } from "@headless-lms/core/organizations";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { startWooSyncWorker } from "../../../fretwise-lms-frontend/lib/server/woocommerce-sync-worker.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {
  throw new Error("This test requires the local test database.");
}
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const org = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const grantId = "ent_3M5mpdySvjVKH2h0cKZEoz9TtoZ";
const student = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
const course = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
const source = "integration:woocommerce-local-test";
const testActor = `local-sync-rollback-${Date.now()}`;
const rollback = new Error("rollback local test");
try {
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`,
      );
      const ledger = new PurchaseSyncLedgerRepository(tx);
      const key = { orgId: org, orgUserId: student, integrationId: "woocommerce-local-test" };
      const state = { capturedAt: 1, known: { course: ["123"], subscription: [] } };
      assert.equal(await ledger.get(key), null);
      await ledger.initialize(key);
      await ledger.initialize(key);
      assert.deepEqual(await ledger.get(key), { revision: 0, state: null });
      assert.equal(await ledger.replace(key, 0, state), true);
      assert.equal(await ledger.replace(key, 0, state), false);
      assert.deepEqual(await ledger.get(key), { revision: 1, state });
      const repo = new DrizzleEntitlementsRepository(tx);
      const existing = await repo.lockGrant(org, { orgUserId: student, contentId: course });
      assert.equal(existing?.id, grantId);
      assert.equal(existing?.status, "revoked");
      assert.equal(existing?.source, "automation");
      assert.equal(
        await repo.insertIntegrationGrant(org, { orgUserId: student, contentId: course, source }),
        null,
      );
      const changed = await tx.execute(
        sql`update entitlements set source = ${source}, updated_at = date_trunc('milliseconds', now()) where org_id = ${org} and id = ${grantId} returning id`,
      );
      assert.equal(changed.rowCount, 1);
      const owned = await repo.lockGrant(org, { orgUserId: student, contentId: course });
      assert.ok(owned);
      const activated = await repo.transitionIntegrationGrant(org, {
        id: grantId,
        source,
        expectedStatus: "revoked",
        expectedUpdatedAt: owned.updatedAt,
        status: "active",
      });
      assert.equal(activated?.status, "active");
      await new DrizzleOutboxAppender(tx).append([
        entitlementEvents.entitlementCreated.make({
          orgId: org,
          data: activated,
          metadata: { actorId: testActor },
        }),
      ]);
      const pending = await tx.execute(
        sql`select id from event_outbox where payload->'metadata'->>'actorId' = ${testActor}`,
      );
      assert.equal(pending.rowCount, 1);
      assert.equal(
        await repo.transitionIntegrationGrant(org, {
          id: grantId,
          source,
          expectedStatus: "revoked",
          expectedUpdatedAt: owned.updatedAt,
          status: "active",
        }),
        null,
      );
      assert.equal(
        await repo.transitionIntegrationGrant(org, {
          id: grantId,
          source: "integration:other",
          expectedStatus: "active",
          expectedUpdatedAt: activated.updatedAt,
          status: "revoked",
        }),
        null,
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`,
      );
      await tx.execute(sql`delete from entitlements where org_id = ${org} and id = ${grantId}`);
      const testBundle = `bnd_sync_${Date.now()}`;
      await tx.execute(
        sql`insert into bundles (org_id, id, name) values (${org}, ${testBundle}, 'Temporary sync test')`,
      );
      await tx.execute(
        sql`insert into bundle_items (org_id, bundle_id, content_id) values (${org}, ${testBundle}, ${course})`,
      );
      const scope = {
        ledger: new PurchaseSyncLedgerRepository(tx),
        grants: new DrizzleEntitlementsRepository(tx),
        outbox: new DrizzleOutboxAppender(tx),
      };
      const service = new PurchaseSyncService({ run: async (fn) => fn(scope) });
      const actor = actorWith({ id: testActor, orgId: org, owner: true });
      const input = {
        orgUserId: student,
        integrationId: "woocommerce-local-test",
        courseId: course,
        bundleId: testBundle,
        expectedRevision: 0,
        snapshot: { capturedAt: 1, known: { course: ["123"], subscription: ["456"] } },
        decisions: { course: "grant", subscription: "grant" },
      } as const;
      await assert.rejects(service.commit(input, actorWith({ id: student, orgId: org })));
      assert.equal(
        await scope.ledger.get({
          orgId: org,
          orgUserId: student,
          integrationId: input.integrationId,
        }),
        null,
      );
      assert.deepEqual(await service.commit(input, actor), { held: [] });
      const grant = await scope.grants.lockIntegrationGrant(org, {
        orgUserId: student,
        contentId: course,
      });
      assert.equal(grant?.grant.status, "active");
      assert.equal(grant?.grant.source, source);
      await assert.rejects(service.commit(input, actor));
      const bundleEnded = {
        ...input,
        expectedRevision: 1,
        snapshot: { ...input.snapshot, capturedAt: 2 },
        decisions: { course: "grant", subscription: "revoke" },
      } as const;
      assert.deepEqual(await service.commit(bundleEnded, actor), { held: [] });
      assert.equal(await scope.grants.hasAccess(org, student, course), true);
      const directEnded = {
        ...input,
        expectedRevision: 2,
        snapshot: { ...input.snapshot, capturedAt: 3 },
        decisions: { course: "revoke", subscription: "grant" },
      } as const;
      assert.deepEqual(await service.commit(directEnded, actor), { held: [] });
      assert.equal(await scope.grants.hasAccess(org, student, course), true);
      const bothEnded = {
        ...input,
        expectedRevision: 3,
        snapshot: { ...input.snapshot, capturedAt: 4 },
        decisions: { course: "revoke", subscription: "revoke" },
      } as const;
      assert.deepEqual(await service.commit(bothEnded, actor), { held: [] });
      assert.equal(await scope.grants.hasAccess(org, student, course), false);
      await tx.execute(
        sql`update entitlements set source = 'manual' where org_id = ${org} and id = ${grant!.grant.id}`,
      );
      const next = {
        ...input,
        expectedRevision: 4,
        snapshot: { ...input.snapshot, capturedAt: 5 },
        decisions: { course: "grant", subscription: "hold" },
      } as const;
      assert.deepEqual(await service.commit(next, actor), { held: ["course", "subscription"] });
      const overridden = await scope.grants.lockIntegrationGrant(org, {
        orgUserId: student,
        contentId: course,
      });
      assert.equal(overridden?.grant.status, "revoked");
      assert.equal(overridden?.grant.source, "manual");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`,
      );
      await tx.execute(sql`delete from entitlements where org_id = ${org} and id = ${grantId}`);
      const bundleId = `bnd_worker_${Date.now()}`;
      await tx.execute(
        sql`insert into bundles (org_id, id, name) values (${org}, ${bundleId}, 'Temporary worker test')`,
      );
      await tx.execute(
        sql`insert into bundle_items (org_id, bundle_id, content_id) values (${org}, ${bundleId}, ${course})`,
      );
      const scope = {
        ledger: new PurchaseSyncLedgerRepository(tx),
        grants: new DrizzleEntitlementsRepository(tx),
        outbox: new DrizzleOutboxAppender(tx),
      };
      const actor = actorWith({ id: testActor, orgId: org, owner: true });
      const service = new PurchaseSyncService({ run: async (fn) => fn(scope) });
      const key = { orgId: org, orgUserId: student, integrationId: "woocommerce-local-test" };
      const store = createWooLmsStore({
        managesSubscription: true,
        ...key,
        courseId: course,
        bundleId,
        readLedger: () => scope.ledger.get(key),
        commit: (input) => service.commit(input, actor),
        reportHeld: () => {
          throw new Error("Unexpected held grant.");
        },
      });
      let runs = 0;
      let complete: (() => void) | undefined;
      let failed: ((error: unknown) => void) | undefined;
      const finished = new Promise<void>((resolve, reject) => {
        complete = resolve;
        failed = reject;
      });
      const worker = startWooSyncWorker({
        intervalMs: 10,
        onError: (error) => failed?.(error),
        reconcile: async () => {
          const status = runs === 1 ? "cancelled" : "active";
          await reconcileWooPurchases({
            store,
            customerId: 3,
            courseProductId: 10,
            subscriptionProductId: 20,
            maxAgeMs: 60_000,
            now: Date.now,
            readSnapshot: async () => ({
              capturedAt: Date.now(),
              orders: [
                {
                  id: 1,
                  customer_id: 3,
                  status: "completed",
                  line_items: [{ product_id: 10 }],
                  date_paid_gmt: "2026-11-01T00:00:00",
                  refunds: [],
                },
              ],
              subscriptions: [{ id: 2, customer_id: 3, status, line_items: [{ product_id: 20 }] }],
            }),
          });
          const subscription = await scope.grants.lockIntegrationGrant(org, {
            orgUserId: student,
            bundleId,
          });
          assert.equal(subscription?.grant.status, status === "active" ? "active" : "revoked");
          assert.equal(await scope.grants.hasAccess(org, student, course), true);
          if (++runs === 3) {complete?.();}
        },
      });
      try {
        await finished;
      } finally {
        await worker.stop();
      }
      assert.equal(runs, 3);
      assert.equal((await scope.ledger.get(key))?.revision, 3);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
  const check = await new DrizzleEntitlementsRepository(db).lockGrant(org, {
    orgUserId: student,
    contentId: course,
  });
  assert.equal(check?.id, grantId);
  assert.equal(check?.status, "revoked");
  assert.equal(check?.source, "automation");
  const events = await db.execute(
    sql`select id from event_outbox where payload->'metadata'->>'actorId' = ${testActor}`,
  );
  assert.equal(events.rowCount, 0);
  process.stdout.write(
    "Local synchronization and staff override passed; transactions rolled back.\n",
  );
} finally {
  await pool.end();
}
