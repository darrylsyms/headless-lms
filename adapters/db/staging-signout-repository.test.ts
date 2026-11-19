import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleIdentityRepository } from "./src/repositories/identity.js";

test("staging member nonce consumption is scoped, gated and one-use", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") { throw new Error("The local test database is required."); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  const previousSync = process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC, previousSignout = process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT;
  try {
    await client.query("begin");
    await client.query("create temporary table users (id text, external_id text) on commit drop");
    await client.query("create temporary table ba_account (user_id text, provider_id text, account_id text) on commit drop");
    await client.query("create temporary table wordpress_identity_snapshots (user_id text, issuer text, subject text) on commit drop");
    await client.query("create temporary table fretwise_staging_signout_nonces (nonce_hash text primary key, expires_at_ms bigint) on commit drop");
    await client.query("insert into users values ('person', 'auth')");
    await client.query("insert into ba_account values ('auth', 'fretwise-wordpress-staging', '23003226')");
    await client.query("insert into wordpress_identity_snapshots values ('person', 'https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc', '23003226')");
    const repo = new DrizzleIdentityRepository(drizzle(client));
    const nonce = randomBytes(32).toString("base64url"), expiry = Date.now() + 30000;
    process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC = "1";
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = "0";
    assert.equal(await repo.consumeStagingSignoutNonce("person", nonce, expiry), false);
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = "1";
    assert.equal(await repo.consumeStagingSignoutNonce("other", nonce, expiry), false);
    assert.equal(await repo.consumeStagingSignoutNonce("person", nonce, expiry), true);
    assert.equal(await repo.consumeStagingSignoutNonce("person", nonce, expiry), false);
    assert.equal(await repo.consumeStagingSignoutNonce("person", randomBytes(32).toString("base64url"), Date.now() - 1), false);
    await client.query("rollback");
  } finally {
    if (previousSync === undefined) { delete process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC; } else { process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC = previousSync; }
    if (previousSignout === undefined) { delete process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT; } else { process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = previousSignout; }
    client.release(); await pool.end();
  }
});
