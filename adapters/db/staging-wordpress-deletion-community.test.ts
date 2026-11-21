import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { retainWordPressMemberContributions } from "./staging-wordpress-deletion-community.js";

test("retains community content, replies and uploads with an anonymous author", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Local test database required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table org_users (org_id text,id text) on commit drop`);
      await tx.execute(sql`create temporary table posts (org_id text,id text,org_user_id text,title text,body text) on commit drop`);
      await tx.execute(sql`create temporary table comments (org_id text,id text,org_user_id text,parent_id text,body text) on commit drop`);
      await tx.execute(sql`create temporary table messages (org_id text,id text,org_user_id text,client_id text,body text) on commit drop`);
      await tx.execute(sql`create temporary table assets (org_id text,id text,uploaded_by text,source text) on commit drop`);
      await tx.execute(sql`insert into org_users values ('org','placeholder')`);
      await tx.execute(sql`insert into posts values ('org','post','deleted','Title','Body'),('other','post','deleted','Keep','Keep')`);
      await tx.execute(sql`insert into comments values ('org','c1','deleted',null,'Comment'),('org','c2','other','c1','Reply')`);
      await tx.execute(sql`insert into messages values ('org','m1','deleted','unique-id','Message')`);
      await tx.execute(sql`insert into assets values ('org','a1','deleted','member'),('org','a2','deleted','library')`);
      await retainWordPressMemberContributions(tx, "org", "deleted", "placeholder");
      assert.deepEqual((await tx.execute(sql`select org_user_id,title,body from posts where org_id='org'`)).rows, [{ org_user_id: "placeholder", title: "Title", body: "Body" }]);
      assert.deepEqual((await tx.execute(sql`select org_user_id,parent_id,body from comments order by id`)).rows, [{ org_user_id: "placeholder", parent_id: null, body: "Comment" }, { org_user_id: "other", parent_id: "c1", body: "Reply" }]);
      assert.deepEqual((await tx.execute(sql`select org_user_id,client_id,body from messages`)).rows, [{ org_user_id: "placeholder", client_id: null, body: "Message" }]);
      assert.deepEqual((await tx.execute(sql`select uploaded_by from assets order by id`)).rows, [{ uploaded_by: "placeholder" }, { uploaded_by: "deleted" }]);
      assert.equal((await tx.execute(sql`select title from posts where org_id='other'`)).rows[0]?.title, "Keep");
      await assert.rejects(retainWordPressMemberContributions(tx, "org", "deleted", "missing"), /placeholder/);
    });
  } finally { await pool.end(); }
});
