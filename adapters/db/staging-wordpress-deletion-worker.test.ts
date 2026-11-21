import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { processStagingWordPressDeletion } from "./staging-wordpress-deletion-worker.js";

test("deletion retains member uploads and completes an isolated account atomically", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Local test database required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`create temporary table staging_wordpress_deletion_jobs (issuer text,event_id text,subject text,state text,lease_id text,lease_until timestamptz,completed_at timestamptz)`);
    await client.query(`create temporary table users (id text primary key,external_id text,email text unique,first_name text,last_name text); create temporary table user_profiles (user_id text); create temporary table ba_user (id text); create temporary table ba_account (id text,user_id text,provider_id text,account_id text); create temporary table wordpress_identity_snapshots (issuer text,subject text,user_id text); create temporary table organizations (id text,owner_id text); create temporary table org_users (org_id text,id text,user_id text,status text,primary key(org_id,id),unique(org_id,user_id)); create temporary table assets (id text,org_id text,uploaded_by text,source text); create temporary table invites (invited_by text); create temporary table progress_records (org_id text,org_user_id text);`);
    await client.query(`create temporary table posts (org_id text,id text,org_user_id text,title text,body text,extra jsonb,cover_asset_id text,topic_id text,pinned boolean,updated_at timestamptz); create temporary table comments (org_id text,id text,org_user_id text,parent_id text); create temporary table messages (org_id text,id text,org_user_id text,reply_to_id text,client_id text); create temporary table chat_users (org_id text,last_read_message_id text); create temporary table mentions (org_id text,item_type text,item_id text,org_user_id text);`);
    await client.query(`insert into staging_wordpress_deletion_jobs values ('issuer','event_1234567890123456','123','running','lease',now()+interval '2 minutes',null); insert into users values ('person','auth','person@example.test',null,null); insert into ba_user values ('auth'); insert into ba_account values ('account','auth','provider','123'); insert into wordpress_identity_snapshots values ('issuer','123','person'); insert into org_users values ('org','member','person','active'); insert into assets values ('upload','org','member','member'); insert into progress_records values ('org','member');`);
    const db = drizzle(client);
    const job = { issuer: "issuer", eventId: "event_1234567890123456", subject: "123", leaseId: "lease", attempts: 1 };
    const options = { issuer: "issuer", providerId: "provider", allowedSubjects: new Set(["123"]) };
    await assert.rejects(processStagingWordPressDeletion(db, job, { ...options, allowedSubjects: new Set<string>() }), /not permitted/);
    assert.equal((await db.execute(sql`select count(*)::int as count from users`)).rows[0]?.count, 1);
    await processStagingWordPressDeletion(db, job, options);
    assert.equal((await db.execute(sql`select count(*)::int as count from users where id='person'`)).rows[0]?.count, 0);
    assert.equal((await db.execute(sql`select count(*)::int as count from progress_records`)).rows[0]?.count, 0);
    assert.match(String((await db.execute(sql`select uploaded_by from assets`)).rows[0]?.uploaded_by), /^deleted_author_/);
    assert.equal((await db.execute(sql`select state from staging_wordpress_deletion_jobs`)).rows[0]?.state, "done");
  } finally { client.release(); await pool.end(); }
});
