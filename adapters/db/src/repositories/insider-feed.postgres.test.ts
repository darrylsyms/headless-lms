import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { genId } from "@headless-lms/core/shared/id";
import { DrizzleContentRepository } from "./content.js";
import { DrizzleInsiderCategoriesRepository } from "./insider-categories.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Insider Feed in PostgreSQL", () => {
  let pool: pg.Pool;
  let content: DrizzleContentRepository;
  let categories: DrizzleInsiderCategoriesRepository;
  const org = genId("organization");
  const user = genId("user");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    content = new DrizzleContentRepository(drizzle(pool));
    categories = new DrizzleInsiderCategoriesRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,$1,$1,$2)", [
      org,
      user,
    ]);
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
  it("creates one hidden backing course under concurrent requests and keeps categories separate", async () => {
    expect(await content.getInsiderFeed(org)).toBeNull();
    const [feed, again] = await Promise.all([
      content.ensureInsiderFeed(org),
      content.ensureInsiderFeed(org),
    ]);
    expect(again).toEqual(feed);
    expect((await content.listCourses(org, { page: 1, pageSize: 20 })).rows).toEqual([]);
    expect((await content.findCourseById(org, feed.courseId))?.settings.comments?.enabled).toBe(
      true,
    );
    const activity = await content.saveActivity(org, feed.courseId, feed.moduleId, {
      settings: {
        title: "Lesson",
        category: "Technique",
        difficulty: "beginner",
        published: false,
      },
    });
    await categories.change(org, "Technique");
    await categories.change(org, "Rhythm", "Technique");
    expect((await content.findActivity(org, activity.activity.id))?.settings).toMatchObject({
      category: "Rhythm",
      difficulty: "beginner",
    });
    await categories.delete(org, "Rhythm");
    expect((await content.findActivity(org, activity.activity.id))?.settings).toMatchObject({
      category: "",
    });
  });
});
