import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { genId } from "@headless-lms/core/shared/id";
import { DrizzleContentRepository } from "./content.js";
import { DrizzleCourseCategoriesRepository } from "./course-categories.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("course categories in PostgreSQL", () => {
  let pool: pg.Pool;
  let repo: DrizzleCourseCategoriesRepository;
  const org = genId("organization");
  const user = genId("user");
  const courses = [genId("course"), genId("course")];
  const moduleId = genId("module");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new DrizzleCourseCategoriesRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,$1,$1,$2)", [
      org,
      user,
    ]);
    for (const id of courses) {
      await pool.query("insert into content_items (org_id,id,type) values ($1,$2,'course')", [
        org,
        id,
      ]);
      await pool.query(
        "insert into courses (org_id,id,title,slug,category) values ($1,$2,$2,$2,'')",
        [org, id],
      );
    }
  });
  afterAll(async () => {
    if (!pool) {
      return;
    }
    await pool.query("delete from settings where org_id=$1", [org]);
    await pool.query("delete from activities where org_id=$1", [org]);
    await pool.query("delete from modules where org_id=$1", [org]);
    await pool.query("delete from courses where org_id=$1", [org]);
    await pool.query("delete from content_items where org_id=$1", [org]);
    await pool.query("delete from organizations where id=$1", [org]);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  });
  it("defaults difficulty and persists updates", async () => {
    const content = new DrizzleContentRepository(drizzle(pool));
    expect((await content.findCourseById(org, courses[0]!))?.difficulty).toBe("all_levels");
    await content.updateCourse(org, courses[0]!, { difficulty: "advanced" });
    expect((await content.findCourseById(org, courses[0]!))?.difficulty).toBe("advanced");
    expect(
      (await content.listCourses(org, { page: 1, pageSize: 20 })).rows.find(
        (course) => course.id === courses[0],
      )?.difficulty,
    ).toBe("advanced");
  });
  it("persists publication dates for courses and activities", async () => {
    const content = new DrizzleContentRepository(drizzle(pool));
    const date = "2024-06-01T12:34:00.000Z";
    await content.updateCourse(org, courses[0]!, { publishedAt: date });
    expect((await content.findCourseById(org, courses[0]!))?.publishedAt?.toISOString()).toBe(date);
    await pool.query(
      "insert into modules (org_id,id,course_id,title,seq) values ($1,$2,$3,'Test',0)",
      [org, moduleId, courses[0]],
    );
    const created = await content.saveActivity(org, courses[0]!, moduleId, {
      settings: { published: false },
    });
    expect(created.activity.publishedAt).toBeNull();
    const updated = await content.saveActivity(
      org,
      courses[0]!,
      moduleId,
      { settings: { published: true }, publishedAt: date },
      created.activity.id,
    );
    expect(updated.activity.publishedAt?.toISOString()).toBe(date);
  });
  it("publishes due drafts once and leaves future schedules untouched", async () => {
    const db = drizzle(pool);
    const due = new Date("2001-01-01T00:00:00.000Z");
    const future = new Date("2999-01-01T00:00:00.000Z");
    const now = new Date("2020-01-01T00:00:00.000Z");
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`update courses set status = 'draft', scheduled_at = ${due} where org_id = ${org} and id = ${courses[0]}`);
      await tx.execute(sql`update courses set status = 'draft', scheduled_at = ${future} where org_id = ${org} and id = ${courses[1]}`);
      const content = new DrizzleContentRepository(tx);
      const released = await content.publishDueCourses(now);
      const ours = released.filter((course) => course.orgId === org);
      expect(ours).toHaveLength(1);
      expect(ours[0]?.publishedAt?.toISOString()).toBe(due.toISOString());
      expect(ours[0]?.scheduledAt).toBeNull();
      expect((await content.findCourseById(org, courses[1]!))?.status).toBe("draft");
      expect((await content.publishDueCourses(now)).filter((course) => course.orgId === org)).toHaveLength(0);
      const mod = genId("module");
      const first = genId("activity");
      const second = genId("activity");
      await tx.execute(sql`insert into modules (org_id,id,course_id,title,seq) values (${org},${mod},${courses[0]},'Release',99)`);
      await tx.execute(sql`insert into activities (org_id,id,course_id,module_id,seq,settings,scheduled_at) values (${org},${first},${courses[0]},${mod},0,'{"published":false}'::jsonb,${due}), (${org},${second},${courses[0]},${mod},1,'{"published":false}'::jsonb,${future})`);
      const published = (await content.publishDueActivities(now)).filter((activity) => activity.orgId === org);
      expect(published).toHaveLength(1);
      expect(published[0]?.id).toBe(first);
      expect(published[0]?.settings).toEqual({ published: true });
      expect(published[0]?.publishedAt?.toISOString()).toBe(due.toISOString());
      expect(published[0]?.scheduledAt).toBeNull();
      expect((await content.publishDueActivities(now)).filter((activity) => activity.orgId === org)).toHaveLength(0);

      throw new Error("rollback publication test");
    })).rejects.toThrow("rollback publication test");
  });
  it("starts empty and renames every assigned course", async () => {
    expect(await repo.list(org)).toEqual([]);
    expect(
      (await pool.query("select category from courses where org_id=$1", [org])).rows.map(
        (r) => r.category,
      ),
    ).toEqual(["", ""]);
    expect(await repo.change(org, "Guitar")).toEqual(["Guitar"]);
    await pool.query("update courses set category='Guitar' where org_id=$1", [org]);
    expect(await repo.change(org, "Guitar Basics", "Guitar")).toEqual(["Guitar Basics"]);
    expect(
      (await pool.query("select category from courses where org_id=$1", [org])).rows.map(
        (r) => r.category,
      ),
    ).toEqual(["Guitar Basics", "Guitar Basics"]);
    await expect(repo.change(org, "guitar basics")).rejects.toThrow();
    expect(await repo.list(org)).toEqual(["Guitar Basics"]);
    expect(await repo.delete(org, "Guitar Basics")).toEqual([]);
    expect(
      (await pool.query("select category from courses where org_id=$1", [org])).rows.map(
        (r) => r.category,
      ),
    ).toEqual(["", ""]);
    await expect(repo.delete(org, "Guitar Basics")).rejects.toThrow();
  });
});
