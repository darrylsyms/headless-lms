import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { StagingSignoutNonceStore } from "./staging-signout-nonce-store.js";

test("a sign-out proof nonce is accepted once across database connections", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") { throw new Error("The local test database is required."); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const a = await pool.connect(), b = await pool.connect();
  const schema = `test_signout_${process.pid}_${Date.now()}`;
  try {
    await a.query(`create schema ${schema}`); await a.query(`set search_path to ${schema}`); await b.query(`set search_path to ${schema}`);
    await a.query(await readFile(new URL("./staging-signout-nonce-schema.sql", import.meta.url), "utf8"));
    const nonce = randomBytes(32).toString("base64url"), until = Date.now() + 60000;
    const one = new StagingSignoutNonceStore(a), two = new StagingSignoutNonceStore(b);
    const results = await Promise.all([one.consume(nonce, until), two.consume(nonce, until)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(await one.consume(nonce, until), false);
    assert.equal(await one.consume(randomBytes(32).toString("base64url"), Date.now() - 1), false);
    const stored = await a.query("select nonce_hash from fretwise_staging_signout_nonces");
    assert.notEqual(stored.rows[0].nonce_hash, nonce);
    await one.removeExpired(until); assert.equal((await a.query("select count(*)::int as count from fretwise_staging_signout_nonces")).rows[0].count, 0);
  } finally { await a.query(`drop schema if exists ${schema} cascade`); a.release(); b.release(); await pool.end(); }
});
