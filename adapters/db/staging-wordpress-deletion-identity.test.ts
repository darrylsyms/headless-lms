import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { resolveWordPressDeletionIdentity } from "./staging-wordpress-deletion-identity.js";

test("deletion requires matching verified bindings and refuses ambiguous identities or owners", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Local test database required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table users (id text, external_id text) on commit drop`);
      await tx.execute(sql`create temporary table ba_account (id text, user_id text, provider_id text, account_id text) on commit drop`);
      await tx.execute(sql`create temporary table wordpress_identity_snapshots (issuer text, subject text, user_id text) on commit drop`);
      await tx.execute(sql`create temporary table organizations (id text, owner_id text) on commit drop`);
      await tx.execute(sql`insert into users values ('member','auth'); insert into ba_account values ('account','auth','provider','123'); insert into wordpress_identity_snapshots values ('issuer','123','member')`);
      assert.deepEqual(await resolveWordPressDeletionIdentity(tx, "issuer", "provider", "123"), { userId: "member", authId: "auth" });
      await assert.rejects(resolveWordPressDeletionIdentity(tx, "issuer", "provider", "456"), /review/);
      await assert.rejects(resolveWordPressDeletionIdentity(tx, "issuer", "other", "123"), /review/);
      await tx.execute(sql`insert into ba_account values ('other','auth','other','x')`);
      await assert.rejects(resolveWordPressDeletionIdentity(tx, "issuer", "provider", "123"), /review/);
      await tx.execute(sql`delete from ba_account where id='other'; insert into organizations values ('org','member')`);
      await assert.rejects(resolveWordPressDeletionIdentity(tx, "issuer", "provider", "123"), /review/);
    });
  } finally { await pool.end(); }
});
