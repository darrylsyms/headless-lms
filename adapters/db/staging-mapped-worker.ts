import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { PurchaseSyncWebhookJobsRepository } from "./src/repositories/purchase-sync-webhook-jobs.js";
import { PurchaseSyncFailuresRepository } from "./src/repositories/purchase-sync-failures.js";
import { PurchaseSyncHealthRepository } from "./src/repositories/purchase-sync-health.js";
import { ProductCourseMappingsRepository } from "./src/repositories/product-course-mappings.js";
import { createWooPurchaseReader } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reader.js";
import { reconcileWooAccounts } from "../../../fretwise-lms-frontend/lib/server/woocommerce-account-sync.js";
import { createCoalescingRunner, startWooSyncWorker } from "../../../fretwise-lms-frontend/lib/server/woocommerce-sync-worker.js";
import { startLocalWooWebhookServer } from "../../../fretwise-lms-frontend/lib/server/woocommerce-webhook.js";
import { stagingTestCustomer } from "./staging-test-customer.js";
import { createWooGeneralStores } from "./woocommerce-general-stores.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
const credentials = { key: process.env.FRETWISE_STAGING_WOO_KEY ?? "", secret: process.env.FRETWISE_STAGING_WOO_SECRET ?? "" };
if (!credentials.key || !credentials.secret) {throw new Error("Staging read credentials required.");}
const readPurchases = createWooPurchaseReader({ origin: "https://getfretwise-cydd.1wp.site", allowedOrigins: ["https://getfretwise-cydd.1wp.site"], credentials });
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const subscriptionBundleId = "bun_3M6XL2rrAXRI4fMdDKIFul0m4L1";
const fixtureCourseId = process.env.FRETWISE_STAGING_FIXTURE_COURSE_ID;
const pool = new pg.Pool({ connectionString: url.toString() });
const db = drizzle(pool);
const productMappings = new ProductCourseMappingsRepository(db);
const failures = new PurchaseSyncFailuresRepository(db);
const health = new PurchaseSyncHealthRepository(db);
const stores = createWooGeneralStores(db, {orgId, providerId: "fretwise-wordpress-staging", subscriptionBundleId, subscriptionIntegrationId: "woocommerce-local-test"});
const runner = createCoalescingRunner(async () => {
  const result = await reconcileWooAccounts({
    listVerifiedCustomers: async () => (await stores.listVerifiedCustomers()).filter((customer) => customer.customerId !== 23003226 && !!stagingTestCustomer(String(customer.customerId))),
    listCourseMappings: async () => {
      const all = await productMappings.list(orgId);
      if (fixtureCourseId) {
        const rows = await db.execute(sql`select id from courses where org_id = ${orgId} and id = ${fixtureCourseId} and title = 'Fretwise Webhook Test (local only)'`);
        if (rows.rows.length !== 1) {throw new Error("The local webhook test course is unavailable.");}
      }
      return all.filter((mapping) => (!fixtureCourseId || mapping.courseId === fixtureCourseId) && mapping.productIds.every((id) => id === 22049175 || id === 22049189));
    },
    readSnapshot: async (customerId) => {
      const snapshot = await readPurchases(customerId);
      if (snapshot.subscriptions.some((subscription) => !Array.isArray(subscription.line_items) || subscription.line_items.length === 0 || subscription.line_items.some((item) => item.product_id !== 22049176))) {throw new Error("Only approved staging subscriptions may be used.");}
      return { ...snapshot, capturedAt: Date.now() };
    },
    prepareCustomer: stores.prepareCustomer,
    courseStore: stores.courseStore,
    subscriptionStore: stores.subscriptionStore,
    recordOutcome: async ({ customer, target, state }) => failures.record(orgId, customer.orgUserId, target.kind === "course" ? `course:${target.courseId}` : target.kind, state),
    now: Date.now, maxAgeMs: 300000,
  }).catch(async (error: unknown) => {await health.record(orgId, "woocommerce-local-test", "error"); throw error;});
  await health.record(orgId, "woocommerce-local-test", "ok");
  process.stdout.write(`Staging checks: ${result.customers} customers, ${result.succeeded} completed, ${result.failed} require retry or review.\n`);
  if (result.failed) {throw new Error("Some staging checks need retry or review.");}
});
const worker = startWooSyncWorker({ intervalMs: 30000, reconcile: () => runner.request(), onError: () => process.stderr.write("Staging check failed; scheduled retry remains active.\n") });
const jobs = new PurchaseSyncWebhookJobsRepository(db);
const queueRunner = createCoalescingRunner(async () => {
  for (let i = 0; i < 20; i++) {
    const job = await jobs.claim(orgId);
    if (!job) {return;}
    try {
      await runner.request();
      if (!(await jobs.complete(orgId, job))) {throw new Error("Webhook lease expired.");}
    } catch {
      await jobs.retry(orgId, job, Math.min(3600, 30 * 2 ** Math.min(job.attempts - 1, 7)));
      process.stderr.write("Webhook check needs retry.\n");
    }
  }
});
const queueWorker = startWooSyncWorker({ intervalMs: 30000, reconcile: () => queueRunner.request(), onError: () => process.stderr.write("Webhook queue check failed; scheduled retry remains active.\n") });
const secret = process.env.FRETWISE_STAGING_WEBHOOK_SECRET;
const listener = secret ? await startLocalWooWebhookServer({ secret, port: 8016, enqueue: async (job) => {
  await jobs.enqueue(orgId, job);
  void queueRunner.request().catch(() => process.stderr.write("Webhook queue check failed; scheduled retry remains active.\n"));
} }) : undefined;
let stopping = false;
async function stop() { if (stopping) {return;} stopping = true; await listener?.close(); await queueWorker.stop(); await queueRunner.stop(); await worker.stop(); await runner.stop(); await pool.end(); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
