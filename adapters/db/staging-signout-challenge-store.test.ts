import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { StagingSignoutChallengeStore } from "./src/staging-signout-challenge-store.js";

test("session-bound challenges reject other browsers, sessions and replay", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("The local test database is required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const a = await pool.connect(), b = await pool.connect();
  const schema = `test_challenge_${process.pid}_${Date.now()}`;
  try {
    await a.query(`create schema ${schema}`);
    await a.query(`set search_path to ${schema}`);
    await b.query(`set search_path to ${schema}`);
    await a.query(await readFile(new URL("./staging-signout-challenge-schema.sql", import.meta.url), "utf8"));
    const first = new StagingSignoutChallengeStore(a), second = new StagingSignoutChallengeStore(b);
    const binding = randomBytes(32).toString("base64url"), another = randomBytes(32).toString("base64url");
    const challenge = await first.issue("23003226", "wordpress-to-lms", binding, 1000);
    assert.ok(challenge);
    assert.equal(await first.consume(challenge, "23003226", "wordpress-to-lms", another, 1001), false);
    assert.equal(await first.consume(challenge, "23003227", "wordpress-to-lms", binding, 1001), false);
    assert.equal(await first.consume(challenge, "23003226", "lms-to-wordpress", binding, 1001), false);
    const stored = await a.query("select challenge_hash, binding_hash from fretwise_staging_signout_challenges");
    assert.notEqual(stored.rows[0].challenge_hash, challenge);
    assert.notEqual(stored.rows[0].binding_hash, binding);
    const results = await Promise.all([first.consume(challenge, "23003226", "wordpress-to-lms", binding, 1001), second.consume(challenge, "23003226", "wordpress-to-lms", binding, 1001)]);
    assert.deepEqual(results.sort(), [false, true]);
    const expiring = await first.issue("23003226", "lms-to-wordpress", binding, 1000);
    assert.ok(expiring);
    assert.equal(await first.consume(expiring, "23003226", "lms-to-wordpress", binding, 61000), false);
    await first.removeExpired(61000);
    assert.equal((await a.query("select count(*)::int as count from fretwise_staging_signout_challenges")).rows[0].count, 0);
    assert.equal(await first.issue("1", "lms-to-wordpress", binding, 1000), null);
  } finally {
    await a.query(`drop schema if exists ${schema} cascade`);
    a.release(); b.release(); await pool.end();
  }
});
