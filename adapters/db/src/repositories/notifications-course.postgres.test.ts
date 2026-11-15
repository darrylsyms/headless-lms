import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { genId } from "@headless-lms/core/shared/id";
import { DrizzleNotificationsRepository } from "./notifications.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("course notification pagination", () => {
  let pool: pg.Pool;
  let repo: DrizzleNotificationsRepository;
  const org = genId("organization"), user = genId("user"), member = genId("orgUser");
  const course = genId("course"), other = genId("course");
  const moduleId = genId("module"), otherModule = genId("module");
  const activity = genId("activity"), otherActivity = genId("activity"), draftActivity = genId("activity");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new DrizzleNotificationsRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,'Test',$1,$2)", [org, user]);
    await pool.query("insert into org_users (org_id,id,user_id) values ($1,$2,$3)", [org, member, user]);
    for (const [courseId, mod, act] of [[course, moduleId, activity], [other, otherModule, otherActivity]]) {
      await pool.query("insert into content_items (org_id,id,type) values ($1,$2,'course')", [org, courseId]);
      await pool.query("insert into courses (org_id,id,title,slug) values ($1,$2,'Test',$2)", [org, courseId]);
      await pool.query("insert into modules (org_id,id,course_id,title,seq) values ($1,$2,$3,'Test',0)", [org, mod, courseId]);
      await pool.query("insert into activities (org_id,id,course_id,module_id,seq) values ($1,$2,$3,$4,0)", [org, act, courseId, mod]);
    }
    await pool.query("insert into activities (org_id,id,course_id,module_id,seq,settings) values ($1,$2,$3,$4,1,$5)", [org, draftActivity, course, moduleId, JSON.stringify({ published: false })]);
    for (let i = 0; i < 28; i++) {
      const comment = genId("comment"), notification = genId("notification");
      const act = i === 25 ? otherActivity : i === 26 ? draftActivity : activity;
      await pool.query("insert into comments (org_id,id,activity_id,org_user_id,body,status) values ($1,$2,$3,$4,'Test',$5)", [org, comment, act, member, i === 27 ? "removed" : "published"]);
      await pool.query("insert into notifications (org_id,id,user_id,type,scope,reasons,matched_reason,category,subject_type,subject_id,parent_type,parent_id,display,in_app,read_at) values ($1,$2,$3,'comment.created','org',ARRAY['subject'],'subject','replies_to_my_comments','comment',$4,'activity',$5,'{}',true,$6)", [org, notification, user, comment, act, i === 0 ? new Date() : null]);
    }
  });
  afterAll(async () => {
    if (!pool) { return; }
    await pool.query("delete from notifications where org_id=$1", [org]);
    await pool.query("delete from comments where org_id=$1", [org]);
    await pool.query("delete from activities where org_id=$1", [org]);
    await pool.query("delete from modules where org_id=$1", [org]);
    await pool.query("delete from courses where org_id=$1", [org]);
    await pool.query("delete from content_items where org_id=$1", [org]);
    await pool.query("delete from org_users where org_id=$1", [org]);
    await pool.query("delete from organizations where id=$1", [org]);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  });
  it("returns accurate counts and separate pages without other courses", async () => {
    const filter = { courseId: course, type: ["comment.created", "comment.reacted"] };
    const first = await repo.page(org, user, filter, { page: 1, pageSize: 20 });
    const second = await repo.page(org, user, filter, { page: 2, pageSize: 20 });
    expect(first.total).toBe(25);
    expect(first.unreadCount).toBe(24);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
    expect(first.items.every((item) => item.parent?.id === activity)).toBe(true);
    const target = first.items[0]!.id;
    const single = await repo.page(org, user, { ...filter, notificationId: target }, { page: 1, pageSize: 1 });
    expect(single.total).toBe(1);
    expect(single.items[0]?.id).toBe(target);
    const wrongCourse = await repo.page(org, user, { ...filter, courseId: other, notificationId: target }, { page: 1, pageSize: 1 });
    expect(wrongCourse.total).toBe(0);
    const wrongUser = await repo.page(org, "other-user", { ...filter, notificationId: target }, { page: 1, pageSize: 1 });
    expect(wrongUser.total).toBe(0);
  });
});
