import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { actorWith } from "@headless-lms/core/organizations";
import { DrizzleUnitOfWork } from "./src/unit-of-work.js";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { ProductCourseMappingsRepository } from "./src/repositories/product-course-mappings.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "@headless-lms/core/entitlements";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { courseSyncIntegrationId, type VerifiedCustomer, type CourseProductMapping } from "../../../fretwise-lms-frontend/lib/server/woocommerce-mapping-sync.js";

export function createWooGeneralStores(db: NodePgDatabase, config: { orgId: string; providerId: string; subscriptionBundleId: string; subscriptionIntegrationId?: string }) {
  if (!config.orgId || !config.providerId || !config.subscriptionBundleId) {throw new Error("Missing synchronization configuration.");}
  const ledger = new PurchaseSyncLedgerRepository(db);
  const service = new PurchaseSyncService(new DrizzleUnitOfWork(db, (tx) => ({ ledger: new PurchaseSyncLedgerRepository(tx), grants: new DrizzleEntitlementsRepository(tx), outbox: new DrizzleOutboxAppender(tx), productMappings: new ProductCourseMappingsRepository(tx), identity: new PurchaseSyncMappingsRepository(tx) })));
  const actor = actorWith({ id: "woocommerce-sync", orgId: config.orgId, owner: true });
  async function link(customer: VerifiedCustomer) {
    await db.transaction((tx) => new PurchaseSyncMappingsRepository(tx).linkVerifiedCustomer(config.orgId, customer.orgUserId, config.providerId, customer.customerId));
  }
  const common = (customer: VerifiedCustomer, integrationId: string) => ({
    orgUserId: customer.orgUserId, integrationId, bundleId: config.subscriptionBundleId,
    expectedIdentity: { providerId: config.providerId, customerId: customer.customerId },
    readLedger: () => ledger.get({ orgId: config.orgId, orgUserId: customer.orgUserId, integrationId }),
    commit: (input: Parameters<typeof service.commit>[0]) => service.commit(input, actor),
    reportHeld: () => {throw new Error("Access requires review.");},
  });
  return {
    listVerifiedCustomers: () => db.transaction((tx) => new PurchaseSyncMappingsRepository(tx).discoverVerifiedCustomers(config.orgId, config.providerId)),
    listCourseMappings: () => new ProductCourseMappingsRepository(db).list(config.orgId),
    prepareCustomer: link,
    async courseStore(customer: VerifiedCustomer, mapping: CourseProductMapping) {
      await link(customer);
      const integrationId = courseSyncIntegrationId(mapping.courseId);
      return createWooLmsStore({ ...common(customer, integrationId), courseId: mapping.courseId, expectedCourseProductIds: mapping.productIds, managesSubscription: false });
    },
    async subscriptionStore(customer: VerifiedCustomer) {
      const configured = await db.execute(sql`select bundle_id from purchase_sync_all_access_bundles where org_id=${config.orgId} and bundle_id=${config.subscriptionBundleId}`);
      if (configured.rows.length !== 1) {throw new Error("Platform-wide subscription target unavailable.");}
      await link(customer);
      return createWooLmsStore({ ...common(customer, config.subscriptionIntegrationId ?? "woocommerce-subscription"), managesCourse: false, managesSubscription: true });
    },
  };
}
