import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { StagingAccountHandoffStore } from "./staging-account-handoff-store.js";

test("database redemption is one-use, browser-bound and expires", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") { throw new Error("The local test database is required."); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    const schema = await readFile(new URL("./staging-account-handoff-schema.sql", import.meta.url), "utf8");
    await client.query(schema.replace("CREATE TABLE ", "CREATE TEMPORARY TABLE ").replace("CREATE INDEX fretwise_staging_account_handoffs_expiry_idx", "CREATE INDEX fretwise_test_account_handoffs_expiry_idx"));
    const store = new StagingAccountHandoffStore(client);
    const record = { codeHash: "a".repeat(64), browserHash: "b".repeat(64), sessionRef: "session-id", customerId: 23003226, destination: { kind: "orders" as const }, expiresAt: 60000 };
    await store.insert(record);
    assert.equal(await store.consume(record.codeHash, "c".repeat(64), 1), null);
    const results = await Promise.all([store.consume(record.codeHash, record.browserHash, 1), store.consume(record.codeHash, record.browserHash, 1)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual(results.find(Boolean), record);
    await store.insert({ ...record, codeHash: "d".repeat(64) });
    assert.equal(await store.consume("d".repeat(64), record.browserHash, 60000), null);
    await store.removeExpired(60000);
    assert.equal((await client.query("select count(*)::int as count from fretwise_staging_account_handoffs")).rows[0].count, 0);
    await assert.rejects(store.insert({ ...record, customerId: 7 }));
  } finally { client.release(); await pool.end(); }
});

test("competing database connections cannot redeem the same code twice", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") { throw new Error("The local test database is required."); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const first = await pool.connect();
  const second = await pool.connect();
  const schemaName = `test_handoff_${process.pid}_${Date.now()}`;
  try {
    await first.query(`create schema ${schemaName}`);
    await first.query(`set search_path to ${schemaName}`);
    await second.query(`set search_path to ${schemaName}`);
    await first.query(await readFile(new URL("./staging-account-handoff-schema.sql", import.meta.url), "utf8"));
    const a = new StagingAccountHandoffStore(first), b = new StagingAccountHandoffStore(second);
    const record = { codeHash: "e".repeat(64), browserHash: "f".repeat(64), sessionRef: "session-id", customerId: 23003226, destination: { kind: "orders" as const }, expiresAt: 60000 };
    await a.insert(record);
    const results = await Promise.all([a.consume(record.codeHash, record.browserHash, 1), b.consume(record.codeHash, record.browserHash, 1)]);
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    await first.query(`drop schema if exists ${schemaName} cascade`);
    first.release(); second.release(); await pool.end();
  }
});
