import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { processStagingWordPressDeletion } from "./staging-wordpress-deletion-worker.js";
import { StagingWordPressDeletionQueue } from "./staging-wordpress-deletion-queue.js";
import { startStagingWordPressDeletionListener } from "../../../fretwise-lms-frontend/lib/server/wordpress-deletion-listener.js";
import { DrizzleAdminRepository } from "./src/repositories/admin.js";
import { DrizzleMemberRepository } from "./src/repositories/member.js";
import { DrizzleDiscussionRepository } from "./src/repositories/discussion.js";

test("real schema: removed member and sessions disappear while community content remains anonymous", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Local test database required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const id = randomUUID();
  const owner = `owner_${id}`, person = `user_${id}`, other = `other_${id}`, otherMember = `other_ou_${id}`, auth = `auth_${id}`, org = `org_${id}`, member = `ou_${id}`, community = `com_${id}`, space = `spc_${id}`, post = `pst_${id}`;
  const rollback = new Error("intentional rollback");
  try {
    await assert.rejects(drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table staging_wordpress_deletion_jobs (issuer text,event_id text,subject text,state text default 'pending',attempts integer default 0,next_attempt_at timestamptz default now(),created_at timestamptz default now(),lease_id text,lease_until timestamptz,completed_at timestamptz,primary key(issuer,event_id)) on commit drop`);
      await tx.execute(sql`insert into users (id,email,external_id) values (${owner},${`${owner}@test.invalid`},null),(${person},${`${person}@test.invalid`},${auth}),(${other},${`${other}@test.invalid`},null)`);
      await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${auth},'Test',${`${person}@test.invalid`},false,now(),now())`);
      await tx.execute(sql`insert into ba_account (id,user_id,provider_id,account_id,created_at,updated_at) values (${`acc_${id}`},${auth},'provider',${id},now(),now())`);
      await tx.execute(sql`update ba_account set account_id='123456789' where id=${`acc_${id}`}`);
      await tx.execute(sql`insert into ba_session (id,token,user_id,expires_at,created_at,updated_at) values (${`session_${id}`},${`token_${id}`},${auth},now()+interval '1 hour',now(),now())`);
      await tx.execute(sql`insert into wordpress_identity_snapshots (issuer,subject,user_id) values ('issuer','123456789',${person})`);
      await tx.execute(sql`insert into organizations (id,name,slug,owner_id) values (${org},${org},${org},${owner})`);
      await tx.execute(sql`insert into org_users (org_id,id,user_id,status) values (${org},${member},${person},'active'),(${org},${otherMember},${other},'active')`);
      await tx.execute(sql`insert into content_items (org_id,id,type) values (${org},${community},'community')`);
      await tx.execute(sql`insert into communities (org_id,id,title,slug,status) values (${org},${community},'Community',${community},'published')`);
      await tx.execute(sql`insert into spaces (org_id,id,community_id,name,seq) values (${org},${space},${community},'Space',0)`);
      await tx.execute(sql`insert into posts (org_id,id,community_id,space_id,org_user_id,title,body,status) values (${org},${post},${community},${space},${member},'Kept post','Kept body','published')`);
      await tx.execute(sql`insert into comments (org_id,id,post_id,community_id,org_user_id,body,status) values (${org},${`comment_${id}`},${post},${community},${otherMember},'Other member reply','published')`);
      await tx.execute(sql`insert into assets (org_id,id,key,kind,source,filename,content_type,uploaded_by) values (${org},${`asset_${id}`},${`uploads/${id}`},'image','member','picture.png','image/png',${member})`);
      const db = tx as unknown as NodePgDatabase;
      const queue = new StagingWordPressDeletionQueue(db, "issuer");
      const secret = "test-secret-with-at-least-32-bytes";
      const body = JSON.stringify({ type: "wordpress.user.deleted", issuer: "issuer", eventId: "event_1234567890123456", subject: "123456789" });
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      const listener = await startStagingWordPressDeletionListener({ secret, issuer: "issuer", port: 0, enqueue: event => queue.enqueue(event) });
      try {
        const endpoint = `http://127.0.0.1:${listener.port}/wordpress-account-deleted`;
        assert.equal((await fetch(endpoint, { method: "POST", body, headers: { "x-fretwise-signature": signature } })).status, 202);
        assert.equal((await fetch(endpoint, { method: "POST", body, headers: { "x-fretwise-signature": signature } })).status, 202);
      } finally { await listener.close(); }
      const job = await queue.claim();
      assert.ok(job);
      await processStagingWordPressDeletion(db, job, { issuer: "issuer", providerId: "provider", allowedSubjects: new Set([job.subject]) });
      assert.equal(await queue.claim(), null);
      assert.equal((await tx.execute(sql`select count(*)::int as n from users where id=${person}`)).rows[0]?.n, 0);
      assert.equal((await tx.execute(sql`select count(*)::int as n from ba_session where user_id=${auth}`)).rows[0]?.n, 0);
      const row = (await tx.execute(sql`select title,body,org_user_id from posts where org_id=${org} and id=${post}`)).rows[0]!;
      assert.equal(row.title, "Kept post"); assert.equal(row.body, "Kept body");
      const placeholder = String(row.org_user_id);
      const authors = await new DrizzleDiscussionRepository(db).authorsOf(org, [placeholder]);
      assert.equal(authors[placeholder]?.firstName, "Deleted");
      assert.equal((await tx.execute(sql`select body from comments where org_id=${org} and post_id=${post}`)).rows[0]?.body, "Other member reply");
      assert.equal((await tx.execute(sql`select uploaded_by from assets where org_id=${org} and id=${`asset_${id}`}`)).rows[0]?.uploaded_by, placeholder);
      const students = await new DrizzleAdminRepository(db).listStudents(org, { page: 1, pageSize: 20 }, "member");
      assert.equal(students.rows.some(student => student.id === placeholder || student.id === member), false);
      assert.equal(students.rows.some(student => student.id === otherMember), true);
      const directory = await new DrizzleMemberRepository(db).directory(org, community, { page: 1, pageSize: 20 }, [placeholder, otherMember]);
      assert.equal(directory.rows.some(item => item.orgUserId === placeholder || item.orgUserId === member), false);
      assert.equal(directory.rows.some(item => item.orgUserId === otherMember), true);
      throw rollback;
    }), error => error === rollback);
  } finally { await pool.end(); }
});
