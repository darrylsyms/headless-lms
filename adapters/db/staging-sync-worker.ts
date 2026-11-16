import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { actorWith } from "@headless-lms/core/organizations";
import { DrizzleUnitOfWork } from "./src/unit-of-work.js";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { ProductCourseMappingsRepository } from "./src/repositories/product-course-mappings.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { readStagingPurchases } from "../../../fretwise-lms-frontend/lib/server/staging-woo-reader.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { createCoalescingRunner, reconcileWooCustomers, startWooSyncWorker } from "../../../fretwise-lms-frontend/lib/server/woocommerce-sync-worker.js";
import { startLocalWooWebhookServer } from "../../../fretwise-lms-frontend/lib/server/woocommerce-webhook.js";
import { stagingTestCustomer } from "./staging-test-customer.js";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "8005" ||
  databaseUrl.pathname !== "/fretwise_lms"
)
  {throw new Error("This worker is restricted to the local test database.");}
const credentials = {
  key: process.env.FRETWISE_STAGING_WOO_KEY ?? "",
  secret: process.env.FRETWISE_STAGING_WOO_SECRET ?? "",
};
if (!credentials.key || !credentials.secret)
  {throw new Error("Temporary staging read credentials are required.");}
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const requestedCustomer = process.env.FRETWISE_STAGING_NEW_CUSTOMER_ID;
const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
const integrationId = "woocommerce-local-test";
const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
const db = drizzle(pool);
const requestedIds = process.env.FRETWISE_STAGING_MULTICUSTOMER === "1"
  ? ["23003227", "23003228"]
  : [requestedCustomer ?? "23003227"];
const mappings = [];
for (const customer of requestedIds) {
  const approved = stagingTestCustomer(customer);
  if (!approved || approved.customerId === 23003226) {throw new Error("The staging customer is not permitted.");}
  const result = await db.execute(sql`select org_user_id from purchase_sync_customers where org_id = ${orgId} and customer_id = ${approved.customerId}`);
  if (result.rows.length !== 1) {throw new Error("The staging member is not mapped.");}
  const orgUserId = String(result.rows[0]!.org_user_id);
  const mapping = await db.transaction((tx) => new PurchaseSyncMappingsRepository(tx).get(orgId, orgUserId, integrationId));
  if (!mapping || mapping.customerId !== approved.customerId || mapping.courseId !== courseId || mapping.courseProductId !== 22049175 || mapping.subscriptionProductIds.length !== 1 || mapping.subscriptionProductIds[0] !== 22049176) {throw new Error("The approved staging mapping is required.");}
  const bundleItems = await db.execute(sql`select content_id from bundle_items where org_id = ${orgId} and bundle_id = ${mapping.bundleId}`);
  if (bundleItems.rows.length !== 1 || bundleItems.rows[0]?.content_id !== courseId) {throw new Error("The staging bundle must contain only the test course.");}
  mappings.push(mapping);
}
const productMappings = new ProductCourseMappingsRepository(db);
const ledger = new PurchaseSyncLedgerRepository(db);
const service = new PurchaseSyncService(
  new DrizzleUnitOfWork(db, (tx) => ({
    ledger: new PurchaseSyncLedgerRepository(tx),
    grants: new DrizzleEntitlementsRepository(tx),
    outbox: new DrizzleOutboxAppender(tx),
    productMappings: new ProductCourseMappingsRepository(tx),
  })),
);
const actor = actorWith({ id: "staging-sync-worker", orgId, owner: true });
const runner = createCoalescingRunner(async () => {
    const result = await reconcileWooCustomers({
      customers: mappings,
      onError: () => process.stderr.write("A staging customer sync failed; it will retry.\n"),
      reconcile: async (mapping) => {
        const orgUserId = mapping.orgUserId;
        const current = await db.transaction((tx) => new PurchaseSyncMappingsRepository(tx).get(orgId, orgUserId, integrationId));
        if (JSON.stringify(current) !== JSON.stringify(mapping)) {throw new Error("The staging mapping changed.");}
        const savedProducts = await productMappings.get(orgId, courseId);
        const courseProductIds = savedProducts?.productIds ?? [mapping.courseProductId];
        if (!courseProductIds.includes(mapping.courseProductId) || courseProductIds.some((id) => id !== 22049175 && id !== 22049189)) {throw new Error("Only approved staging products may be used.");}
        let held = false;
        const store = createWooLmsStore({
          orgUserId, integrationId, courseId, bundleId: mapping.bundleId,
          ...(savedProducts ? { expectedCourseProductIds: courseProductIds } : {}),
          managesSubscription: mapping.managesSubscription,
          readLedger: () => ledger.get({ orgId, orgUserId, integrationId }),
          commit: (input) => service.commit(input, actor),
          reportHeld: (targets) => { held = true; process.stderr.write(`Access held for review: ${targets.join(", ")}\n`); },
        });
        const syncResult = await reconcileWooPurchases({
          store, courseProductIds, customerId: mapping.customerId,
          courseProductId: mapping.courseProductId, subscriptionProductId: mapping.subscriptionProductIds[0]!,
          maxAgeMs: 300000, now: Date.now,
          readSnapshot: async () => ({ ...(await readStagingPurchases(credentials, fetch, mapping.customerId)), capturedAt: Date.now() }),
        });
        if (held || syncResult !== "committed") {throw new Error("The staging customer needs review or retry.");}
      },
    });
    process.stdout.write(`Staging synchronization checked: ${result.succeeded} succeeded, ${result.failed} failed.\n`);
});
const worker = startWooSyncWorker({ intervalMs: 30000, onError: () => process.stderr.write("Staging sync failed; it will retry.\n"), reconcile: () => runner.request() });
const webhookSecret = process.env.FRETWISE_STAGING_WEBHOOK_SECRET;
const listener = webhookSecret ? await startLocalWooWebhookServer({
  secret: webhookSecret, port: 8016,
  enqueue: async () => { void runner.request().catch(() => process.stderr.write("Webhook sync failed; scheduled retry remains active.\n")); },
}) : undefined;
let stopping = false;
async function stop() {
  if (stopping) {return;}
  stopping = true;
  await listener?.close();
  await worker.stop();
  await runner.stop();
  await pool.end();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
