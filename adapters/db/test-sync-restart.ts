import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { actorWith } from "@headless-lms/core/organizations";
import { runMigrations } from "./src/migrate.js";
import { DrizzleUnitOfWork } from "./src/unit-of-work.js";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import type { SyncPlan } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";

const originalUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  originalUrl.hostname !== "127.0.0.1" ||
  originalUrl.port !== "8005" ||
  originalUrl.pathname !== "/fretwise_lms"
) {
  throw new Error("This test requires the local database.");
}
const dbName = `fretwise_sync_test_${randomBytes(8).toString("hex")}`;
const clonedUrl = new URL(originalUrl);
clonedUrl.pathname = `/${dbName}`;
const admin = new pg.Client({ connectionString: originalUrl.toString() });
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
const grantId = "ent_3M5mpdySvjVKH2h0cKZEoz9TtoZ";
const bundleId = `bnd_restart_${randomBytes(8).toString("hex")}`;
const integrationId = "woocommerce-restart-test";
let created = false;
await admin.connect();
try {
  await admin.query(`create database "${dbName}"`);
  created = true;
  const restore = spawnSync(
    "pg_restore",
    [
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      clonedUrl.toString(),
      "tmp/pre-purchase-sync.dump",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (restore.status !== 0) {
    throw new Error("Could not restore the isolated test database.");
  }
  await runMigrations(clonedUrl.toString());
  {
    const pool = new pg.Pool({ connectionString: clonedUrl.toString() });
    const db = drizzle(pool);
    const repo = new DrizzleEntitlementsRepository(db);
    const existing = await repo.lockGrant(orgId, { orgUserId, contentId: courseId });
    assert.equal(existing?.id, grantId);
    assert.equal(existing?.status, "revoked");
    await db.execute(sql`delete from entitlements where org_id = ${orgId} and id = ${grantId}`);
    await db.execute(
      sql`insert into bundles (org_id, id, name) values (${orgId}, ${bundleId}, 'Temporary restart test')`,
    );
    await db.execute(
      sql`insert into bundle_items (org_id, bundle_id, content_id) values (${orgId}, ${bundleId}, ${courseId})`,
    );
    await db.transaction(async (tx) => {
      await new PurchaseSyncMappingsRepository(tx).insert({
        orgId,
        orgUserId,
        integrationId,
        customerId: 3,
        courseProductId: 10,
        subscriptionProductIds: [20, 21],
        courseId,
        bundleId,
        managesSubscription: true,
      });
    });
    const alternatives = await db.execute(
      sql`select id from content_items where org_id = ${orgId} and type = 'course' and id <> ${courseId} limit 1`,
    );
    const anotherCourse = alternatives.rows[0]?.id;
    assert.equal(typeof anotherCourse, "string");
    const another = {
      orgId,
      orgUserId,
      integrationId: "woocommerce-second-course",
      customerId: 3,
      courseProductId: 11,
      subscriptionProductIds: [20, 21],
      courseId: String(anotherCourse),
      bundleId,
      managesSubscription: false,
    };
    await assert.rejects(
      db.transaction((tx) =>
        new PurchaseSyncMappingsRepository(tx).insert({ ...another, customerId: 4 }),
      ),
    );
    await assert.rejects(
      db.transaction((tx) =>
        new PurchaseSyncMappingsRepository(tx).insert({ ...another, managesSubscription: true }),
      ),
    );
    await db.transaction((tx) => new PurchaseSyncMappingsRepository(tx).insert(another));
    await pool.end();
  }
  let last = 0;
  const cycle = async (
    subscriptionStatus: string,
    expectedRevision: number,
    refund: "none" | "partial" | "full" = "none",
  ) => {
    const pool = new pg.Pool({ connectionString: clonedUrl.toString() });
    try {
      const db = drizzle(pool);
      const ledger = new PurchaseSyncLedgerRepository(db);
      const grants = new DrizzleEntitlementsRepository(db);
      const service = new PurchaseSyncService(
        new DrizzleUnitOfWork(db, (tx) => ({
          ledger: new PurchaseSyncLedgerRepository(tx),
          grants: new DrizzleEntitlementsRepository(tx),
          outbox: new DrizzleOutboxAppender(tx),
        })),
      );
      const actor = actorWith({ id: "restart-test", orgId, owner: true });
      const key = { orgId, orgUserId, integrationId };
      const mapping = await db.transaction((tx) =>
        new PurchaseSyncMappingsRepository(tx).get(orgId, orgUserId, integrationId),
      );
      assert.ok(mapping);
      const held: string[] = [];
      const store = createWooLmsStore({
        ...key,
        courseId: mapping.courseId,
        bundleId: mapping.bundleId,
        managesSubscription: mapping.managesSubscription,
        readLedger: () => ledger.get(key),
        commit: (input) => service.commit(input, actor),
        reportHeld: (targets) => held.push(...targets),
      });
      while (Date.now() <= last) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      last = Date.now();
      const snapshot = {
        capturedAt: last,
        orders: [
          {
            id: 1,
            customer_id: 3,
            status: refund === "full" ? "refunded" : "completed",
            line_items: [{ product_id: 10 }],
            date_paid_gmt: "2026-11-01T00:00:00",
            refunds: refund === "none" ? [] : [{}],
          },
        ],
        subscriptions: [
          { id: 2, customer_id: 3, status: subscriptionStatus, line_items: [{ product_id: 20 }] },
        ],
      };
      assert.equal(
        await reconcileWooPurchases({
          store,
          customerId: mapping.customerId,
          courseProductId: mapping.courseProductId,
          subscriptionProductId: mapping.subscriptionProductIds[0]!,
          subscriptionProductIds: mapping.subscriptionProductIds,
          maxAgeMs: 60000,
          now: Date.now,
          readSnapshot: async () => snapshot,
        }),
        "committed",
      );
      assert.deepEqual(held, []);
      assert.equal((await ledger.get(key))?.revision, expectedRevision);
      assert.equal(
        (await grants.lockIntegrationGrant(orgId, { orgUserId, bundleId }))?.grant.status,
        subscriptionStatus === "active" ? "active" : "revoked",
      );
      assert.equal(
        await grants.hasAccess(orgId, orgUserId, courseId),
        subscriptionStatus === "active" || refund !== "full",
      );
    } finally {
      await pool.end();
    }
  };
  await cycle("active", 1);
  await cycle("cancelled", 2);
  await cycle("active", 3);
  await cycle("active", 4, "full");
  await cycle("cancelled", 5, "full");
  await cycle("cancelled", 6, "partial");
  {
    const pool = new pg.Pool({ connectionString: clonedUrl.toString(), max: 3 });
    try {
      const db = drizzle(pool);
      const ledger = new PurchaseSyncLedgerRepository(db);
      const service = new PurchaseSyncService(
        new DrizzleUnitOfWork(db, (tx) => ({
          ledger: new PurchaseSyncLedgerRepository(tx),
          grants: new DrizzleEntitlementsRepository(tx),
          outbox: new DrizzleOutboxAppender(tx),
        })),
      );
      const actor = actorWith({ id: "concurrent-sync-test", orgId, owner: true });
      const key = { orgId, orgUserId, integrationId };
      const current = await ledger.get(key);
      assert.ok(current?.state);
      const plan: SyncPlan = {
        decisions: { course: "grant", subscription: "revoke" },
        reasons: { course: [], subscription: [] },
        ledger: { capturedAt: current.state.capturedAt + 1, known: current.state.known },
      };
      const makeStore = () =>
        createWooLmsStore({
          ...key,
          courseId,
          bundleId,
          managesSubscription: true,
          readLedger: () => ledger.get(key),
          commit: (input) => service.commit(input, actor),
          reportHeld: () => {
            throw new Error("Unexpected held grant.");
          },
        });
      const results = await Promise.allSettled([
        makeStore().commitIfUnchanged("6", plan),
        makeStore().commitIfUnchanged("6", plan),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await ledger.get(key))?.revision, 7);
      const grants = new DrizzleEntitlementsRepository(db);
      const before = await grants.lockIntegrationGrant(orgId, { orgUserId, contentId: courseId });
      assert.ok(before);
      await db.execute(
        sql`update entitlements set status = 'revoked' where org_id = ${orgId} and id = ${before.grant.id}`,
      );
      const nextPlan: SyncPlan = {
        ...plan,
        ledger: { ...plan.ledger, capturedAt: plan.ledger.capturedAt + 1 },
      };
      const held: string[] = [];
      const guardedStore = createWooLmsStore({
        ...key,
        courseId,
        bundleId,
        managesSubscription: true,
        readLedger: () => ledger.get(key),
        commit: (input) => service.commit(input, actor),
        reportHeld: (targets) => held.push(...targets),
      });
      await guardedStore.commitIfUnchanged("7", nextPlan);
      assert.deepEqual(held, ["course"]);
      assert.equal(
        (await grants.lockIntegrationGrant(orgId, { orgUserId, contentId: courseId }))?.grant
          .status,
        "revoked",
      );
    } finally {
      await pool.end();
    }
  }
  process.stdout.write(
    "Persistent synchronization survived new database connections; isolated copy removed.\n",
  );
} finally {
  if (created) {
    await admin.query(`drop database "${dbName}" with (force)`);
  }
  await admin.end();
}
