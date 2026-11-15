import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { actorWith } from "@headless-lms/core/organizations";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { bindStagingIdentityToCustomer } from "./staging-identity-binding.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const db = drizzle(pool);
const suffix = randomBytes(12).toString("hex");
const sessionId = `test_session_${suffix}`;
const accountId = `test_account_${suffix}`;
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
const rollback = new Error("rollback");

try {
  await db.transaction(async (tx) => {
    const people = await tx.execute(sql`
      select u.external_id from org_users ou join users u on u.id = ou.user_id
      where ou.org_id = ${orgId} and ou.id = ${orgUserId} and ou.status = 'active'
    `);
    assert.equal(people.rows.length, 1);
    const authId = String(people.rows[0]!.external_id);
    await tx.execute(sql`delete from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id in ('23003226', '23003227')
      and user_id in (select u.external_id from purchase_sync_customers c join org_users o on o.org_id = c.org_id and o.id = c.org_user_id
        join users u on u.id = o.user_id where c.org_id = ${orgId} and c.customer_id in (23003226, 23003227))`);
    await tx.execute(sql`delete from purchase_sync_customers where org_id = ${orgId} and customer_id = 23003226`);
    const occupied = await tx.execute(sql`
      select id from ba_account where provider_id = 'fretwise-wordpress-staging'
      and (user_id = ${authId} or account_id in ('23003226', '23003227'))
    `);
    assert.equal(occupied.rows.length, 0);
    await tx.execute(sql`
      insert into ba_session (id, token, user_id, expires_at, active_organization_id, created_at, updated_at)
      values (${sessionId}, ${`test_token_${suffix}`}, ${authId}, now() + interval '1 hour', ${orgId}, now(), now())
    `);
    await tx.execute(sql`
      insert into ba_account (id, account_id, provider_id, user_id, created_at, updated_at)
      values (${accountId}, '23003227', 'fretwise-wordpress-staging', ${authId}, now(), now())
    `);
    const expected = { orgId, orgUserId, customerId: 23003227 };
    const binding = await bindStagingIdentityToCustomer(tx, sessionId);
    assert.deepEqual(binding, expected);
    assert.deepEqual(await bindStagingIdentityToCustomer(tx, sessionId), expected);
    const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
    const bundleId = `bnd_identity_${suffix}`;
    const integrationId = "woocommerce-identity-test";
    await tx.execute(sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`);
    await tx.execute(sql`delete from entitlements where org_id = ${orgId} and org_user_id = ${orgUserId} and content_id = ${courseId} and id = 'ent_3M5mpdySvjVKH2h0cKZEoz9TtoZ' and status = 'revoked' and source = 'automation'`);
    await tx.execute(sql`insert into bundles (org_id, id, name) values (${orgId}, ${bundleId}, 'Temporary identity purchase test')`);
    await tx.execute(sql`insert into bundle_items (org_id, bundle_id, content_id) values (${orgId}, ${bundleId}, ${courseId})`);
    const ledger = new PurchaseSyncLedgerRepository(tx);
    const grants = new DrizzleEntitlementsRepository(tx);
    const service = new PurchaseSyncService({
      run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx) }),
    });
    const key = { orgId, orgUserId: binding.orgUserId, integrationId };
    const store = createWooLmsStore({
      ...key, courseId, bundleId, managesSubscription: true,
      readLedger: () => ledger.get(key),
      commit: (input) => service.commit(input, actorWith({ id: 'identity-test', orgId, owner: true })),
      reportHeld: () => { throw new Error('Unexpected grant conflict.'); },
    });
    let capturedAt = Date.now();
    for (const status of ['active', 'cancelled']) {
      capturedAt++;
      await reconcileWooPurchases({
        store, customerId: binding.customerId, courseProductId: 22049175,
        subscriptionProductId: 22049176, maxAgeMs: 300000, now: () => capturedAt,
        readSnapshot: async () => ({
          capturedAt, orders: [], subscriptions: [{ id: 22049185, customer_id: binding.customerId,
            status, line_items: [{ product_id: 22049176 }] }],
        }),
      });
      assert.equal(await grants.hasAccess(orgId, binding.orgUserId, courseId), status === 'active');
    }
    await assert.rejects(bindStagingIdentityToCustomer(tx, "missing-session"));
    await tx.execute(sql`update ba_account set account_id = '023003227' where id = ${accountId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    await tx.execute(sql`update ba_account set account_id = '99999999' where id = ${accountId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    await tx.execute(sql`update ba_account set provider_id = 'different-provider' where id = ${accountId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    await tx.execute(sql`update ba_account set provider_id = 'fretwise-wordpress-staging' where id = ${accountId}`);
    await tx.execute(sql`update ba_account set account_id = '23003226' where id = ${accountId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    await tx.execute(sql`update ba_account set account_id = '23003227' where id = ${accountId}`);
    await tx.execute(sql`update ba_session set expires_at = now() - interval '1 second' where id = ${sessionId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    await tx.execute(sql`update ba_session set expires_at = now() + interval '1 hour', active_organization_id = null where id = ${sessionId}`);
    await assert.rejects(bindStagingIdentityToCustomer(tx, sessionId));
    const newAuthId = `test_auth_${suffix}`;
    const newOrgUserId = `test_member_${suffix}`;
    const newSessionId = `test_new_session_${suffix}`;
    const newAccountId = `test_new_account_${suffix}`;
    const email = `${suffix}@example.test`;
    await tx.execute(sql`
      insert into ba_user (id, name, email, email_verified, created_at, updated_at)
      values (${newAuthId}, 'Disposable test', ${email}, false, now(), now())
    `);
    await tx.execute(sql`
      insert into users (id, external_id, email) values (${newAuthId}, ${newAuthId}, ${email})
    `);
    await tx.execute(sql`
      insert into org_users (org_id, id, user_id, status)
      values (${orgId}, ${newOrgUserId}, ${newAuthId}, 'active')
    `);
    await tx.execute(sql`
      insert into ba_session (id, token, user_id, expires_at, active_organization_id, created_at, updated_at)
      values (${newSessionId}, ${`test_new_token_${suffix}`}, ${newAuthId}, now() + interval '1 hour', ${orgId}, now(), now())
    `);
    await tx.execute(sql`
      insert into ba_account (id, account_id, provider_id, user_id, created_at, updated_at)
      values (${newAccountId}, '23003226', 'fretwise-wordpress-staging', ${newAuthId}, now(), now())
    `);
    assert.deepEqual(await bindStagingIdentityToCustomer(tx, newSessionId), {
      orgId, orgUserId: newOrgUserId, customerId: 23003226,
    });
    capturedAt++;
    await reconcileWooPurchases({
      store, customerId: binding.customerId, courseProductId: 22049175,
      subscriptionProductId: 22049176, maxAgeMs: 300000, now: () => capturedAt,
      readSnapshot: async () => ({
        capturedAt, orders: [], subscriptions: [{ id: 22049185, customer_id: binding.customerId,
          status: 'active', line_items: [{ product_id: 22049176 }] }],
      }),
    });
    assert.equal(await grants.hasAccess(orgId, binding.orgUserId, courseId), true);
    assert.equal(await grants.hasAccess(orgId, newOrgUserId, courseId), false);
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`update ba_account set account_id = '23003226' where id = ${accountId}`);
    }));
    assert.deepEqual(await bindStagingIdentityToCustomer(tx, newSessionId), {
      orgId, orgUserId: newOrgUserId, customerId: 23003226,
    });
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {throw error;}
} finally {
  await pool.end();
}
process.stdout.write("PASS: staging identity binding and conflict checks; all test data rolled back.\n");
