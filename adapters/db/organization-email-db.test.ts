import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DrizzleOrganizationsRepository } from './src/repositories/organizations.js';

test('detects whether there is exactly one organisation', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '8005' || url.pathname !== '/fretwise_lms') { throw new Error('The local test database is required.'); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await drizzle(pool).transaction(async tx => {
      await tx.execute(sql`create temporary table organizations (id text primary key) on commit drop`);
      const repo = new DrizzleOrganizationsRepository(tx as unknown as NodePgDatabase);
      assert.deepEqual(await repo.firstOrganizationIds(), []);
      await tx.execute(sql`insert into organizations values ('org_1')`);
      assert.deepEqual(await repo.firstOrganizationIds(), ['org_1']);
      await tx.execute(sql`insert into organizations values ('org_2'), ('org_3')`);
      assert.equal((await repo.firstOrganizationIds()).length, 2);
    });
  } finally { await pool.end(); }
});
