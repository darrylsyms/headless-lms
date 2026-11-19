import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { genId } from '@headless-lms/core/shared/id';
import { DrizzleContentRepository } from './content.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('activity topic persistence', () => {
  let pool: pg.Pool;
  let repo: DrizzleContentRepository;
  const org = genId('organization'), user = genId('user'), course = genId('course');
  const firstModule = genId('module'), secondModule = genId('module');
  let parent: string, other: string, firstTopic: string, secondTopic: string;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new DrizzleContentRepository(drizzle(pool));
    await pool.query('insert into users (id,email) values ($1,$2)', [user, `${user}@test`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,'Test',$1,$2)", [org, user]);
    await pool.query("insert into content_items (org_id,id,type) values ($1,$2,'course')", [org, course]);
    await pool.query("insert into courses (org_id,id,title,slug) values ($1,$2,'Test',$2)", [org, course]);
    await pool.query("insert into modules (org_id,id,course_id,title,seq) values ($1,$2,$3,'One',0), ($1,$4,$3,'Two',1)", [org, firstModule, course, secondModule]);
    parent = (await repo.saveActivity(org, course, firstModule, { settings: { title: 'Parent' } })).activity.id;
    firstTopic = (await repo.saveActivity(org, course, firstModule, { parentActivityId: parent, settings: { title: 'First topic' } })).activity.id;
    other = (await repo.saveActivity(org, course, firstModule, { settings: { title: 'Other' } })).activity.id;
    secondTopic = (await repo.saveActivity(org, course, firstModule, { parentActivityId: parent, settings: { title: 'Second topic' } })).activity.id;
  });
  afterAll(async () => { await pool?.end(); });
  it('keeps independent sequences for top-level activities and topics', async () => {
    const rows = await repo.listActivitiesForCourse(org, course);
    expect(rows.filter(row => !row.parentActivityId).map(row => [row.id, row.seq])).toEqual([[parent, 0], [other, 1]]);
    expect(rows.filter(row => row.parentActivityId === parent).map(row => [row.id, row.seq])).toEqual([[firstTopic, 0], [secondTopic, 1]]);
    await repo.reorderActivities(org, course, firstModule, [secondTopic, firstTopic], parent);
    await repo.reorderActivities(org, course, firstModule, [other, parent]);
    const updated = await repo.listActivitiesForCourse(org, course);
    expect(updated.filter(row => row.parentActivityId === parent).map(row => row.id)).toEqual([secondTopic, firstTopic]);
    expect(updated.filter(row => !row.parentActivityId).map(row => row.id)).toEqual([other, parent]);
    await expect(repo.reorderActivities(org, course, firstModule, [other])).rejects.toThrow();
  });
  it('moves topics with their parent and deletes them with it', async () => {
    await repo.moveActivity(org, course, firstModule, firstTopic, firstModule, 0, other);
    let moved = await repo.listActivitiesForCourse(org, course);
    expect(moved.find(row => row.id === firstTopic)?.parentActivityId).toBe(other);
    await repo.moveActivity(org, course, firstModule, firstTopic, firstModule, 1, parent);
    moved = await repo.listActivitiesForCourse(org, course);
    expect(moved.filter(row => row.parentActivityId === parent).map(row => row.id)).toEqual([secondTopic, firstTopic]);
    await repo.moveActivity(org, course, firstModule, parent, secondModule, 0);
    await repo.moveActivity(org, course, secondModule, firstTopic, firstModule, 0, other);
    moved = await repo.listActivitiesForCourse(org, course);
    expect(moved.find(row => row.id === firstTopic)).toMatchObject({ parentActivityId: other, moduleId: firstModule });
    await repo.moveActivity(org, course, firstModule, firstTopic, secondModule, 1, parent);
    const rows = await repo.listActivitiesForCourse(org, course);
    expect(rows.filter(row => row.parentActivityId === parent).every(row => row.moduleId === secondModule)).toBe(true);
    await repo.deleteActivity(org, course, secondModule, parent);
    const remaining = await repo.listActivitiesForCourse(org, course);
    expect(remaining.some(row => [parent, firstTopic, secondTopic].includes(row.id))).toBe(false);
  });
});
