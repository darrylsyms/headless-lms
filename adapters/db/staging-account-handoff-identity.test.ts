import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { findStagingHandoffIdentity } from "./staging-account-handoff-identity.js";

test("only a current active session linked to the staging WordPress subject resolves", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") { throw new Error("The local test database is required."); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("create temporary table ba_session (id text, user_id text, active_organization_id text, expires_at timestamptz) on commit drop");
    await client.query("create temporary table users (id text, external_id text) on commit drop");
    await client.query("create temporary table org_users (user_id text, org_id text, status text) on commit drop");
    await client.query("create temporary table ba_account (user_id text, provider_id text, account_id text) on commit drop");
    await client.query("create temporary table wordpress_identity_snapshots (user_id text, issuer text, subject text) on commit drop");
    await client.query("insert into ba_session values ('session', 'auth', 'org_3LudhlwZcnDDRGwc8R0NGHc2jdu', now() + interval '1 hour')");
    await client.query("insert into users values ('person', 'auth')");
    await client.query("insert into org_users values ('person', 'org_3LudhlwZcnDDRGwc8R0NGHc2jdu', 'active')");
    await client.query("insert into ba_account values ('auth', 'fretwise-wordpress-staging', '23003226')");
    await client.query("insert into wordpress_identity_snapshots values ('person', 'https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc', '23003226')");
    const db = drizzle(client);
    assert.deepEqual(await findStagingHandoffIdentity(db, "session"), { sessionRef: "session", customerId: 23003226 });
    await client.query("update ba_session set expires_at = now() - interval '1 second'");
    assert.equal(await findStagingHandoffIdentity(db, "session"), null);
    await client.query("update ba_session set expires_at = now() + interval '1 hour'");
    await client.query("update org_users set status = 'suspended'");
    assert.equal(await findStagingHandoffIdentity(db, "session"), null);
    await client.query("update org_users set status = 'active'");
    await client.query("update wordpress_identity_snapshots set subject = '23003227'");
    assert.equal(await findStagingHandoffIdentity(db, "session"), null);
    await client.query("rollback");
  } finally { client.release(); await pool.end(); }
});
