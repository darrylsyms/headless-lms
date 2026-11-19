import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { storeStagingWordPressProfile } from "./staging-wordpress-profile.js";
import { DrizzleIdentityRepository } from "./src/repositories/identity.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

test("stores and updates only the linked identity without clearing missing claims", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("The local test database is required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table users (id text primary key, external_id text) on commit drop`);
      await tx.execute(sql`create temporary table ba_account (user_id text, provider_id text, account_id text) on commit drop`);
      await tx.execute(sql`create temporary table wordpress_identity_snapshots (issuer text not null, subject text not null, user_id text not null, username text, first_name text, last_name text, email text, updated_at timestamptz default now(), primary key (issuer, subject), unique (issuer, user_id)) on commit drop`);
      await tx.execute(sql`insert into users values ('person', 'auth'), ('other', 'auth2')`);
      await tx.execute(sql`insert into ba_account values ('auth', 'fretwise-wordpress-staging', '123'), ('auth2', 'fretwise-wordpress-staging', '456')`);
      await storeStagingWordPressProfile(tx, "person", { subject: "123", username: "old", firstName: "Alex", lastName: "Smith", email: "old@example.test" });
      await storeStagingWordPressProfile(tx, "person", { subject: "123", username: "new", lastName: null });
      const result = await tx.execute(sql`select username, first_name, last_name, email from wordpress_identity_snapshots where subject = '123'`);
      assert.deepEqual(result.rows[0], { username: "new", first_name: "Alex", last_name: null, email: "old@example.test" });
      const previous = process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC;
      try {
        process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC = "1";
        const repository = new DrizzleIdentityRepository(tx as unknown as NodePgDatabase);
        assert.equal(await repository.findWordPressUsername("person"), "new");
        assert.deepEqual(await repository.findWordPressContact("person"), { username: "new", firstName: "Alex", lastName: null, email: "old@example.test" });
        assert.equal(await repository.findWordPressUsername("other"), null);
        assert.equal(await repository.findStagingCommerceCustomer("person"), null);
        await tx.execute(sql`update ba_account set account_id = '23003226' where user_id = 'auth'`);
        await tx.execute(sql`update wordpress_identity_snapshots set subject = '23003226' where user_id = 'person'`);
        assert.equal(await repository.findStagingCommerceCustomer("person"), 23003226);
        assert.equal(await repository.findStagingCommerceCustomer("other"), null);
        await tx.execute(sql`update ba_account set account_id = '123' where user_id = 'auth'`);
        assert.equal(await repository.findStagingCommerceCustomer("person"), null);
        process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC = "0";
        assert.equal(await repository.findWordPressUsername("person"), null);
        assert.equal(await repository.findStagingCommerceCustomer("person"), null);
      } finally {
        if (previous === undefined) delete process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC;
        else process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC = previous;
      }
      await assert.rejects(storeStagingWordPressProfile(tx, "other", { subject: "123" }), /not linked/);
    });
  } finally { await pool.end(); }
});
