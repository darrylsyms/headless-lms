import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { genId } from "@headless-lms/core/shared/id";
import { DrizzleProgressRepository } from "./progress.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("saved activities in PostgreSQL", () => {
  let pool: pg.Pool;
  let repo: DrizzleProgressRepository;
  const org = genId("organization"),
    user = genId("user"),
    member = genId("orgUser");
  const course = genId("course"),
    moduleId = genId("module"),
    activity = genId("activity");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new DrizzleProgressRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,'Test',$1,$2)", [
      org,
      user,
    ]);
    await pool.query("insert into org_users (org_id,id,user_id) values ($1,$2,$3)", [
      org,
      member,
      user,
    ]);
    await pool.query("insert into content_items (org_id,id,type) values ($1,$2,'course')", [
      org,
      course,
    ]);
    await pool.query("insert into courses (org_id,id,title,slug) values ($1,$2,'Test',$2)", [
      org,
      course,
    ]);
    await pool.query(
      "insert into modules (org_id,id,course_id,title,seq) values ($1,$2,$3,'Test',0)",
      [org, moduleId, course],
    );
    await pool.query(
      "insert into activities (org_id,id,course_id,module_id,seq) values ($1,$2,$3,$4,0)",
      [org, activity, course, moduleId],
    );
  });
  afterAll(async () => {
    if (!pool) {
      return;
    }
    await pool.query("delete from saved_activities where org_id=$1", [org]);
    await pool.query("delete from activities where org_id=$1", [org]);
    await pool.query("delete from modules where org_id=$1", [org]);
    await pool.query("delete from courses where org_id=$1", [org]);
    await pool.query("delete from content_items where org_id=$1", [org]);
    await pool.query("delete from org_users where org_id=$1", [org]);
    await pool.query("delete from organizations where id=$1", [org]);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  });
  it("stores a saved lesson once, scopes reads and removes it", async () => {
    await Promise.all([
      repo.setSaved(org, member, activity, true),
      repo.setSaved(org, member, activity, true),
    ]);
    expect(await repo.savedAmong(org, member, [activity])).toEqual([activity]);
    expect(await repo.savedAmong(org, "other", [activity])).toEqual([]);
    expect(await repo.savedAmong(org, member, [])).toEqual([]);
    await repo.setSaved(org, member, activity, false);
    expect(await repo.savedAmong(org, member, [activity])).toEqual([]);
  });
});
