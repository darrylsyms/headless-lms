import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { actorWith } from "@headless-lms/core/organizations";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { reconcileWooPurchases } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { provisionVerifiedStagingIdentity } from "./staging-identity-provision.js";
import { bindStagingIdentityToCustomer } from "./staging-identity-binding.js";
import { verifyStagingIdentity } from "./staging-verified-identity.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const db = drizzle(pool);
const suffix = randomBytes(12).toString("hex");
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const rollback = new Error("rollback");
const authRequire = createRequire(new URL("../auth/package.json", import.meta.url));
const josePath = createRequire(authRequire.resolve("better-auth")).resolve("jose");
const { generateKeyPair, SignJWT } = await import(pathToFileURL(josePath).href);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const now = Math.floor(Date.now() / 1000);
const signedIdentity = await new SignJWT({ iss: issuer, sub: "23003227", aud: "local-test-client",
  nonce: "local-test-nonce", iat: now, exp: now + 60 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
const verifiedIdentity = await verifyStagingIdentity(signedIdentity, publicKey, "local-test-client", "local-test-nonce");
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id = '23003226'
      and user_id in (select u.external_id from purchase_sync_customers c join org_users o on o.org_id = c.org_id and o.id = c.org_user_id
        join users u on u.id = o.user_id where c.org_id = ${orgId} and c.customer_id = 23003226)`);
    await tx.execute(sql`delete from purchase_sync_customers where org_id = ${orgId} and customer_id = 23003226`);
    const conflicts = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging'
      and account_id = '23003226'`);
    assert.equal(conflicts.rows.length, 0);
    const existing = await provisionVerifiedStagingIdentity(tx, verifiedIdentity);
    assert.equal(existing.orgUserId, "orm_3M1piONtzjSRhD10QdWPIYYEcYz");
    assert.equal(existing.created, false);
    assert.deepEqual(await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003227" }), existing);
    await assert.rejects(provisionVerifiedStagingIdentity(tx, { issuer: "https://wrong.example", subject: "23003227" }));
    await assert.rejects(provisionVerifiedStagingIdentity(tx, { issuer, subject: "023003227" }));
    const collision = `${suffix}@example.test`;
    const fakeId = `collision_${suffix}`;
    await tx.execute(sql`insert into ba_user (id, name, email, email_verified, created_at, updated_at)
      values (${fakeId}, 'Existing account', ${collision}, false, now(), now())`);
    await assert.rejects(provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003226", email: collision }));
    const newToken = await new SignJWT({ iss: issuer, sub: "23003226", aud: "local-test-client",
      nonce: "local-test-nonce", iat: now, exp: now + 60, email: `new-${suffix}@example.test`, name: "Test customer", email_verified: true,
    }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    const newIdentity = await verifyStagingIdentity(newToken, publicKey, "local-test-client", "local-test-nonce");
    const created = await provisionVerifiedStagingIdentity(tx, newIdentity);
    assert.equal(created.created, true);
    assert.notEqual(created.orgUserId, existing.orgUserId);
    const rows = await tx.execute(sql`
      select b.email_verified, m.role, ou.status from ba_user b
      join ba_member m on m.user_id = b.id and m.organization_id = ${orgId}
      join users u on u.external_id = b.id
      join org_users ou on ou.user_id = u.id and ou.org_id = ${orgId}
      where b.id = ${created.authUserId}
    `);
    assert.deepEqual(rows.rows[0], { email_verified: false, role: "participant", status: "active" });
    const sessionId = `test_provision_${suffix}`;
    await tx.execute(sql`insert into ba_session (id, token, user_id, expires_at, active_organization_id, created_at, updated_at)
      values (${sessionId}, ${`test_token_${suffix}`}, ${created.authUserId}, now() + interval '1 hour', ${orgId}, now(), now())`);
    assert.deepEqual(await bindStagingIdentityToCustomer(tx, sessionId), {
      orgId, orgUserId: created.orgUserId, customerId: 23003226,
    });
    assert.equal((await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003226" })).authUserId, created.authUserId);
    const mapping = await new PurchaseSyncMappingsRepository(tx).get(orgId, created.orgUserId, "woocommerce-local-test");
    assert.ok(mapping);
    assert.equal(mapping.customerId, created.customerId);
    const { courseId, bundleId, integrationId } = mapping;
    await tx.execute(sql`create temporary table purchase_sync_ledgers (org_id text not null, org_user_id text not null, integration_id text not null, revision integer not null default 0, state jsonb, primary key (org_id, org_user_id, integration_id)) on commit drop`);
    const ledger = new PurchaseSyncLedgerRepository(tx);
    const grants = new DrizzleEntitlementsRepository(tx);
    const service = new PurchaseSyncService({ run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx) }) });
    const key = { orgId, orgUserId: created.orgUserId, integrationId };
    const store = createWooLmsStore({ ...key, courseId, bundleId, managesSubscription: true,
      readLedger: () => ledger.get(key),
      commit: (input) => service.commit(input, actorWith({ id: "provision-test", orgId, owner: true })),
      reportHeld: () => { throw new Error("Unexpected access conflict."); },
    });
    let capturedAt = Date.now();
    for (const status of ["active", "cancelled"]) {
      capturedAt++;
      await reconcileWooPurchases({ store, customerId: created.customerId, courseProductId: 22049175,
        subscriptionProductId: 22049176, maxAgeMs: 300000, now: () => capturedAt,
        readSnapshot: async () => ({ capturedAt, orders: [], subscriptions: [{ id: 22049185,
          customer_id: created.customerId, status, line_items: [{ product_id: 22049176 }] }] }),
      });
      assert.equal(await grants.hasAccess(orgId, created.orgUserId, courseId), status === "active");
      assert.equal(await grants.hasAccess(orgId, existing.orgUserId, courseId), false);
    }
    const badAccount = `duplicate_${suffix}`;
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`insert into ba_account (id, account_id, provider_id, user_id, created_at, updated_at)
        values (${badAccount}, '23003226', 'fretwise-wordpress-staging', ${fakeId}, now(), now())`);
    }));
    assert.equal((await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003226" })).authUserId, created.authUserId);
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {throw error;}
} finally {
  await pool.end();
}
process.stdout.write("PASS: existing and new staging identity provisioning; conflicts refused and all records rolled back.\n");
