import { sql } from "drizzle-orm";
import { genId, prefixId } from "@headless-lms/core/shared/id";
import { identityEvents } from "@headless-lms/core/identity";
import { organizationEvents } from "@headless-lms/core/organizations";
import type { Tx } from "./src/client.js";
import { DrizzleIdentityRepository } from "./src/repositories/identity.js";
import { DrizzleOrganizationsRepository } from "./src/repositories/organizations.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { stagingTestCustomer } from "./staging-test-customer.js";

const ORG_ID = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const ISSUER = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const PROVIDER = "fretwise-wordpress-staging";

async function ensureTestProducts(tx: Tx, orgUserId: string, customerId: number) {
  const mappings = new PurchaseSyncMappingsRepository(tx);
  const source = await mappings.get(ORG_ID, "orm_3M1piONtzjSRhD10QdWPIYYEcYz", "woocommerce-local-test");
  if (!source || source.customerId !== 23003227 || source.courseId !== "crs_3LxuK59VqScYag90ed9Sa64Pdjx" ||
      source.courseProductId !== 22049175 || source.subscriptionProductIds.length !== 1 ||
      source.subscriptionProductIds[0] !== 22049176 || !source.managesSubscription)
    {throw new Error("The staging product setup needs review.");}
  const items = await tx.execute(sql`select content_id from bundle_items where org_id = ${ORG_ID} and bundle_id = ${source.bundleId}`);
  if (items.rows.length !== 1 || items.rows[0]!.content_id !== source.courseId)
    {throw new Error("The staging subscription bundle needs review.");}
  const existing = await mappings.get(ORG_ID, orgUserId, source.integrationId);
  if (existing) {
    if (existing.customerId !== customerId || existing.courseId !== source.courseId ||
        existing.bundleId !== source.bundleId || existing.courseProductId !== source.courseProductId ||
        existing.subscriptionProductIds.length !== 1 || existing.subscriptionProductIds[0] !== 22049176 ||
        !existing.managesSubscription) {throw new Error("The member's staging product mapping conflicts.");}
    return;
  }
  await mappings.insert({ orgId: ORG_ID, orgUserId, customerId, integrationId: source.integrationId,
    courseId: source.courseId, courseProductId: source.courseProductId, bundleId: source.bundleId,
    subscriptionProductIds: source.subscriptionProductIds, managesSubscription: true });
}

export async function provisionVerifiedStagingIdentity(
  tx: Tx,
  identity: { issuer: string; subject: string; email?: string; name?: string },
) {
  if (identity.issuer !== ISSUER || !/^[1-9]\d*$/.test(identity.subject))
    {throw new Error("Unrecognized staging identity.");}
  const approved = stagingTestCustomer(identity.subject);
  if (!approved)
    {throw new Error("The staging customer is not permitted.");}
  const customerId = approved.customerId;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fretwise-staging-subject:${identity.subject}`}, 0))`);
  const accounts = await tx.execute(sql`select user_id from ba_account where provider_id = ${PROVIDER} and account_id = ${identity.subject}`);
  if (accounts.rows.length > 1) {throw new Error("The WordPress identity is ambiguous.");}
  const mapped = await tx.execute(sql`
    select c.org_user_id, ou.status, u.external_id, b.id as auth_id
    from purchase_sync_customers c
    join org_users ou on ou.org_id = c.org_id and ou.id = c.org_user_id
    join users u on u.id = ou.user_id
    left join ba_user b on b.id = u.external_id
    where c.org_id = ${ORG_ID} and c.customer_id = ${customerId}
  `);
  if (mapped.rows.length > 1) {throw new Error("The customer mapping is ambiguous.");}
  if (mapped.rows.length === 1) {
    const row = mapped.rows[0]!;
    if (row.status !== "active" || typeof row.auth_id !== "string")
      {throw new Error("The mapped member is not ready for sign-in.");}
    const memberships = await tx.execute(sql`select id from ba_member where organization_id = ${ORG_ID} and user_id = ${row.auth_id}`);
    if (memberships.rows.length !== 1) {throw new Error("The mapped authentication membership is ambiguous or missing.");}
    const other = await tx.execute(sql`select account_id from ba_account where provider_id = ${PROVIDER} and user_id = ${row.auth_id}`);
    if (other.rows.length > 1 || (other.rows.length === 1 && other.rows[0]!.account_id !== identity.subject) ||
        (accounts.rows.length === 1 && accounts.rows[0]!.user_id !== row.auth_id))
      {throw new Error("The WordPress identity conflicts with an existing account.");}
    if (accounts.rows.length === 0) {
      await tx.execute(sql`insert into ba_account (id, account_id, provider_id, user_id, created_at, updated_at)
        values (${prefixId("id")}, ${identity.subject}, ${PROVIDER}, ${row.auth_id}, now(), now())`);
    }
    await ensureTestProducts(tx, String(row.org_user_id), customerId);
    return { orgId: ORG_ID, orgUserId: String(row.org_user_id), authUserId: row.auth_id, customerId, created: false };
  }
  if (accounts.rows.length) {throw new Error("The identity has an account without a trusted customer mapping.");}
  const email = identity.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.(test|invalid)$/.test(email)) {throw new Error("A disposable staging email is required.");}
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fretwise-staging-email:${email}`}, 0))`);
  const collisions = await tx.execute(sql`select email from users where lower(email) = ${email}
    union all select email from ba_user where lower(email) = ${email}`);
  if (collisions.rows.length) {throw new Error("An existing account uses this email; review is required.");}
  const authUserId = genId("user");
  const name = identity.name?.trim() || "Fretwise member";
  await tx.execute(sql`insert into ba_user (id, name, email, email_verified, created_at, updated_at)
    values (${authUserId}, ${name}, ${email}, false, now(), now())`);
  const person = await new DrizzleIdentityRepository(tx).insertUser({ id: authUserId, externalId: authUserId, email });
  const member = await new DrizzleOrganizationsRepository(tx).createOrgUser({ orgId: ORG_ID, userId: person.id, status: "active" });
  await tx.execute(sql`insert into ba_member (id, organization_id, user_id, role, created_at)
    values (${prefixId("id")}, ${ORG_ID}, ${authUserId}, 'participant', now())`);
  await tx.execute(sql`insert into ba_account (id, account_id, provider_id, user_id, created_at, updated_at)
    values (${prefixId("id")}, ${identity.subject}, ${PROVIDER}, ${authUserId}, now(), now())`);
  await tx.execute(sql`insert into purchase_sync_customers (org_id, org_user_id, customer_id)
    values (${ORG_ID}, ${member.id}, ${customerId})`);
  await ensureTestProducts(tx, member.id, customerId);
  await new DrizzleOutboxAppender(tx).append([
    identityEvents.userCreated.make({ orgId: "-", data: person }),
    organizationEvents.orgUserLinked.make({ orgId: ORG_ID, data: { ...member, orgRole: { key: "member" } } }),
  ]);
  return { orgId: ORG_ID, orgUserId: member.id, authUserId, customerId, created: true };
}
