import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { genId } from "@headless-lms/core/shared/id";
import { DrizzleContentRepository } from "./content.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("moving an activity between modules", () => {
  let pool: pg.Pool;
  let repo: DrizzleContentRepository;
  const org = genId("organization"),
    user = genId("user"),
    course = genId("course");
  const source = genId("module"),
    target = genId("module"),
    empty = genId("module");
  const first = genId("activity"),
    moving = genId("activity"),
    existing = genId("activity");
  const asset = genId("asset"),
    link = genId("activityAsset");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new DrizzleContentRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,'Test',$1,$2)", [
      org,
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
    for (const [i, id] of [source, target, empty].entries())
      {await pool.query(
        "insert into modules (org_id,id,course_id,title,seq) values ($1,$2,$3,$2,$4)",
        [org, id, course, i],
      );}
    for (const [id, module, seq] of [
      [first, source, 0],
      [moving, source, 1],
      [existing, target, 0],
    ] as const)
      {await pool.query(
        "insert into activities (org_id,id,course_id,module_id,seq,settings) values ($1,$2,$3,$4,$5,$6)",
        [org, id, course, module, seq, JSON.stringify({ title: id })],
      );}
    await pool.query(
      "insert into assets (org_id,id,key,kind,filename,content_type,status,uploaded_by) values ($1,$2,$2,'document','test.pdf','application/pdf','ready',$3)",
      [org, asset, user],
    );
    await pool.query(
      "insert into activity_assets (org_id,id,activity_id,asset_id,seq) values ($1,$2,$3,$4,0)",
      [org, link, moving, asset],
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  it("moves before an existing activity and keeps the activity and its asset", async () => {
    await repo.moveActivity(org, course, source, moving, target, 0);
    const rows = await repo.listActivitiesForCourse(org, course);
    expect(rows.filter((a) => a.moduleId === source).map((a) => [a.id, a.seq])).toEqual([
      [first, 0],
    ]);
    expect(rows.filter((a) => a.moduleId === target).map((a) => [a.id, a.seq])).toEqual([
      [moving, 0],
      [existing, 1],
    ]);
    expect(rows.find((a) => a.id === moving)?.settings).toEqual({ title: moving });
    expect(
      (await repo.listActivityAssetsForCourse(org, course)).some(
        (a) => a.activityId === moving && a.assetId === asset,
      ),
    ).toBe(true);
  });
  it("rejects stale positions without changing either module", async () => {
    await expect(repo.moveActivity(org, course, target, moving, empty, 5)).rejects.toThrow();
    const rows = await repo.listActivitiesForCourse(org, course);
    expect(rows.find((a) => a.id === moving)?.moduleId).toBe(target);
    expect(rows.filter((a) => a.moduleId === empty)).toHaveLength(0);
  });
  it("moves into an empty module", async () => {
    await repo.moveActivity(org, course, target, moving, empty, 0);
    const rows = await repo.listActivitiesForCourse(org, course);
    expect(rows.filter((a) => a.moduleId === target).map((a) => [a.id, a.seq])).toEqual([
      [existing, 0],
    ]);
    expect(rows.filter((a) => a.moduleId === empty).map((a) => [a.id, a.seq])).toEqual([
      [moving, 0],
    ]);
  });
});
