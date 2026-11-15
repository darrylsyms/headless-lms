import { and, eq } from "drizzle-orm";
import type { Tx } from "../client.js";
import { purchaseSyncCustomers, purchaseSyncMappings } from "../schema/integrations.js";

type Mapping = typeof purchaseSyncMappings.$inferInsert;

export class PurchaseSyncMappingsRepository {
  constructor(private readonly db: Tx) {}

  async get(orgId: string, orgUserId: string, integrationId: string) {
    const [mapping] = await this.db
      .select()
      .from(purchaseSyncMappings)
      .where(
        and(
          eq(purchaseSyncMappings.orgId, orgId),
          eq(purchaseSyncMappings.orgUserId, orgUserId),
          eq(purchaseSyncMappings.integrationId, integrationId),
        ),
      )
      .limit(1);
    return mapping ?? null;
  }

  async insert(input: Mapping): Promise<void> {
    const products = input.subscriptionProductIds;
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.integrationId) ||
      ![input.customerId, input.courseProductId, ...products].every(
        (id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647,
      ) ||
      products.length === 0 ||
      products.includes(input.courseProductId) ||
      new Set(products).size !== products.length
    )
      {throw new Error("Invalid purchase sync mapping.");}
    await this.db
      .insert(purchaseSyncCustomers)
      .values({ orgId: input.orgId, orgUserId: input.orgUserId, customerId: input.customerId })
      .onConflictDoNothing();
    await this.db.insert(purchaseSyncMappings).values(input);
  }
}
