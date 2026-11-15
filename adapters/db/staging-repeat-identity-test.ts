import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { provisionVerifiedStagingIdentity } from "./staging-identity-provision.js";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const db = drizzle(pool);
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const rollback = new Error("rollback");
try {
  await db.transaction(async (tx) => {
    const first = await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003226" });
    const second = await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003226" });
    const existing = await provisionVerifiedStagingIdentity(tx, { issuer, subject: "23003227" });
    assert.equal(first.created, false);
    assert.deepEqual(first, second);
    assert.notEqual(first.orgUserId, existing.orgUserId);
    assert.equal(await new DrizzleEntitlementsRepository(tx).hasAccess(first.orgId, first.orgUserId, "crs_3LxuK59VqScYag90ed9Sa64Pdjx"), false);
    const members = await tx.execute(sql`select count(*)::int as count from purchase_sync_customers where org_id = ${first.orgId} and customer_id = 23003226`);
    assert.equal(members.rows[0]?.count, 1);
    const checkoutSubject = process.env.FRETWISE_STAGING_NEW_CUSTOMER_ID;
    if (checkoutSubject) {
      const checkout = await provisionVerifiedStagingIdentity(tx, { issuer, subject: checkoutSubject });
      const repeated = await provisionVerifiedStagingIdentity(tx, { issuer, subject: checkoutSubject });
      assert.equal(checkout.created, false);
      assert.deepEqual(checkout, repeated);
      assert.notEqual(checkout.orgUserId, first.orgUserId);
      assert.notEqual(checkout.orgUserId, existing.orgUserId);
      assert.equal(await new DrizzleEntitlementsRepository(tx).hasAccess(checkout.orgId, checkout.orgUserId, "crs_3LxuK59VqScYag90ed9Sa64Pdjx"), true);
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {throw error;}
} finally {
  await pool.end();
}
process.stdout.write("PASS: repeat identity resolves to the same separate member without inherited course access.\n");
