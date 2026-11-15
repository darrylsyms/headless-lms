import { sql } from "drizzle-orm";
import type { Tx } from "./src/client.js";
import { stagingTestCustomer } from "./staging-test-customer.js";

const STAGING_ORG = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const PROVIDER = "fretwise-wordpress-staging";

export async function bindStagingIdentityToCustomer(tx: Tx, authenticatedSessionId: string) {
  if (!authenticatedSessionId) {throw new Error("An authenticated session is required.");}
  const sessions = await tx.execute(sql`
    select s.user_id, ou.id as org_user_id
    from ba_session s
    join users u on u.external_id = s.user_id
    join org_users ou on ou.user_id = u.id and ou.org_id = ${STAGING_ORG}
    where s.id = ${authenticatedSessionId} and s.active_organization_id = ${STAGING_ORG}
      and s.expires_at > now() and ou.status = 'active'
  `);
  if (sessions.rows.length !== 1) {throw new Error("The staging member session is unavailable.");}
  const session = sessions.rows[0]!;
  const authUserId = String(session.user_id);
  const orgUserId = String(session.org_user_id);
  const accounts = await tx.execute(sql`
    select account_id from ba_account where user_id = ${authUserId} and provider_id = ${PROVIDER}
  `);
  if (accounts.rows.length !== 1) {throw new Error("The staging WordPress identity is ambiguous or missing.");}
  const subject = accounts.rows[0]!.account_id;
  if (typeof subject !== "string" || !/^[1-9]\d*$/.test(subject)) {throw new Error("Invalid WordPress subject.");}
  const approved = stagingTestCustomer(subject);
  if (!approved) {throw new Error("The staging customer is not permitted.");}
  const customerId = approved.customerId;
  const owners = await tx.execute(sql`
    select user_id from ba_account where provider_id = ${PROVIDER} and account_id = ${subject}
  `);
  if (owners.rows.length !== 1 || owners.rows[0]!.user_id !== authUserId)
    {throw new Error("The WordPress identity is linked more than once.");}
  await tx.execute(sql`
    insert into purchase_sync_customers (org_id, org_user_id, customer_id)
    values (${STAGING_ORG}, ${orgUserId}, ${customerId}) on conflict do nothing
  `);
  const mappings = await tx.execute(sql`
    select org_user_id, customer_id from purchase_sync_customers
    where org_id = ${STAGING_ORG} and (org_user_id = ${orgUserId} or customer_id = ${customerId})
  `);
  if (mappings.rows.length !== 1 || mappings.rows[0]!.org_user_id !== orgUserId || mappings.rows[0]!.customer_id !== customerId)
    {throw new Error("The staging customer is already bound to a different account.");}
  return { orgId: STAGING_ORG, orgUserId, customerId };
}
