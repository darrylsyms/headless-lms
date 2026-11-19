import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { DrizzleIdentityRepository } from "./src/repositories/identity.js";

test("display name changes are limited without blocking other profile edits", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("The local test database is required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table users (id text primary key) on commit drop`);
      await tx.execute(sql`create temporary table user_profiles (user_id text primary key, display_name text, headline text, bio text, image_asset_org_id text, image_asset_id text, extra jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()) on commit drop`);
      await tx.execute(sql`create temporary table profile_display_name_changes (user_id text primary key, changed_at timestamptz not null default now()) on commit drop`);
      await tx.execute(sql`insert into users values ('person')`);
      const repo = new DrizzleIdentityRepository(tx as unknown as NodePgDatabase);
      const cooldown = 30 * 24 * 60 * 60;
      assert.equal((await repo.upsertProfile("person", { displayName: "First", displayNameCooldownSeconds: cooldown })).displayName, "First");
      await assert.rejects(repo.upsertProfile("person", { displayName: "Second", displayNameCooldownSeconds: cooldown }), /once every 30 days/);
      assert.equal((await repo.upsertProfile("person", { displayName: "First", bio: "Hello", displayNameCooldownSeconds: cooldown })).bio, "Hello");
      assert.equal((await repo.upsertProfile("person", { bio: "Updated" })).bio, "Updated");
      await tx.execute(sql`update profile_display_name_changes set changed_at = now() - interval '31 days'`);
      assert.equal((await repo.upsertProfile("person", { displayName: "Second", displayNameCooldownSeconds: cooldown })).displayName, "Second");
    });
  } finally { await pool.end(); }
});
