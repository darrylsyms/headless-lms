import { and, eq, sql } from "drizzle-orm";
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

  async listVerifiedCustomers(orgId: string, providerId: string): Promise<{ customerId: number; orgUserId: string }[]> {
    if (!orgId || !providerId) {throw new Error("Organisation and identity provider are required.");}
    const result = await this.db.execute(sql`
      select c.customer_id, c.org_user_id
      from purchase_sync_customers c
      join org_users ou on ou.org_id = c.org_id and ou.id = c.org_user_id and ou.status = 'active'
      join users u on u.id = ou.user_id
      join ba_account a on a.user_id = u.external_id and a.account_id = c.customer_id::text and a.provider_id = ${providerId}
      where c.org_id = ${orgId}
    `);
    return result.rows.map((row) => ({ customerId: Number(row.customer_id), orgUserId: String(row.org_user_id) }));
  }

  async discoverVerifiedCustomers(orgId: string, providerId: string): Promise<{ customerId: number; orgUserId: string }[]> {
    if (!orgId || !providerId) {throw new Error("Organisation and identity provider are required.");}
    const result = await this.db.execute(sql`
      select ou.id as org_user_id, a.account_id, c.customer_id as mapped_customer_id
      from org_users ou
      join users u on u.id = ou.user_id
      join ba_account a on a.user_id = u.external_id and a.provider_id = ${providerId}
      left join purchase_sync_customers c on c.org_id = ou.org_id and c.org_user_id = ou.id
      where ou.org_id = ${orgId} and ou.status = 'active'
    `);
    const customers = new Set<number>(), members = new Set<string>();
    return result.rows.map((row) => {
      const subject = String(row.account_id), orgUserId = String(row.org_user_id), customerId = Number(subject);
      if (!/^[1-9][0-9]{0,9}$/.test(subject) || !Number.isSafeInteger(customerId) || customerId > 2147483647 || customers.has(customerId) || members.has(orgUserId) || (row.mapped_customer_id !== null && Number(row.mapped_customer_id) !== customerId)) {throw new Error("Ambiguous WordPress identity requires review.");}
      customers.add(customerId); members.add(orgUserId);
      return { customerId, orgUserId };
    });
  }

  async linkVerifiedCustomer(orgId: string, orgUserId: string, providerId: string, customerId: number): Promise<void> {
    if (!orgId || !orgUserId || !providerId || !Number.isSafeInteger(customerId) || customerId <= 0 || customerId > 2147483647) {throw new Error("Invalid customer identity.");}
    const identity = await this.db.execute(sql`select ou.id from org_users ou join users u on u.id=ou.user_id join ba_account a on a.user_id=u.external_id and a.provider_id=${providerId} and a.account_id=${String(customerId)} where ou.org_id=${orgId} and ou.id=${orgUserId} and ou.status='active' for update of ou,u,a`);
    if (identity.rows.length !== 1) {throw new Error("Verified customer identity unavailable.");}
    await this.db.execute(sql`insert into purchase_sync_customers (org_id,org_user_id,customer_id) values (${orgId},${orgUserId},${customerId}) on conflict do nothing`);
    if (!(await this.lock(orgId, orgUserId, providerId, customerId))) {throw new Error("Customer identity conflicts with an existing link.");}
  }

  async lock(orgId: string, orgUserId: string, providerId: string, customerId: number): Promise<boolean> {
    const result = await this.db.execute(sql`select c.customer_id from purchase_sync_customers c join org_users ou on ou.org_id=c.org_id and ou.id=c.org_user_id and ou.status='active' join users u on u.id=ou.user_id join ba_account a on a.user_id=u.external_id and a.provider_id=${providerId} and a.account_id=c.customer_id::text where c.org_id=${orgId} and c.org_user_id=${orgUserId} and c.customer_id=${customerId} for update of c,ou,u,a`);
    return result.rows.length === 1;
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
