import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createContainer } from "../../packages/server/dist/index.js";
import { loadServerConfig } from "../../apps/api/src/config.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
const integrationId = "woocommerce-local-test";
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const db = drizzle(pool);
const existing = await db.transaction((tx) =>
  new PurchaseSyncMappingsRepository(tx).get(orgId, orgUserId, integrationId),
);
if (existing) {
  if (
    existing.customerId !== 23003227 ||
    existing.courseId !== courseId ||
    existing.courseProductId !== 22049175 ||
    existing.subscriptionProductIds.length !== 1 ||
    existing.subscriptionProductIds[0] !== 22049176 ||
    !existing.managesSubscription
  )
    {throw new Error("The existing test mapping is different and needs review.");}
  await pool.end();
  process.stdout.write("The local staging mapping already exists.\n");
  process.exit(0);
}
const container = await createContainer(loadServerConfig());
const actor = container.organizations.systemActor(orgId);
const bundle = await container.content.createBundle(
  { name: "Fretwise staging subscription test (local only)", contentIds: [courseId] },
  actor,
);
try {
  const items = await container.content.listBundleItems(bundle.id, actor);
  if (items.length !== 1 || items[0]?.contentId !== courseId)
    {throw new Error("Unexpected staging bundle contents.");}
  await db.transaction((tx) =>
    new PurchaseSyncMappingsRepository(tx).insert({
      orgId,
      orgUserId,
      integrationId,
      customerId: 23003227,
      courseProductId: 22049175,
      subscriptionProductIds: [22049176],
      courseId,
      bundleId: bundle.id,
      managesSubscription: true,
    }),
  );
  process.stdout.write("The local staging customer and test products are mapped.\n");
} catch (error) {
  await container.content.deleteBundle(bundle.id, actor);
  throw error;
} finally {
  await pool.end();
}
process.exit(0);
