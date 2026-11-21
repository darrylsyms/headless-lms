import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { StagingWordPressDeletionQueue } from "./staging-wordpress-deletion-queue.js";

test("persists deduplicated jobs and leases them to only one worker", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") throw new Error("Local test database required.");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const a = await pool.connect(), b = await pool.connect();
  const schema = `test_deletion_queue_${process.pid}_${Date.now()}`;
  try {
    await a.query(`create schema ${schema}`);
    await a.query(`set search_path to ${schema}`);
    await b.query(`set search_path to ${schema}`);
    await a.query(await readFile(new URL("./staging-wordpress-deletion-queue.sql", import.meta.url), "utf8"));
    const one = new StagingWordPressDeletionQueue(drizzle(a), "issuer"), two = new StagingWordPressDeletionQueue(drizzle(b), "issuer");
    const event = { issuer: "issuer", eventId: "event_1234567890123456", subject: "123" };
    await one.enqueue(event);
    await one.enqueue(event);
    await assert.rejects(one.enqueue({ ...event, subject: "456" }), /conflict/);
    await assert.rejects(one.enqueue({ ...event, issuer: "wrong" }), /Invalid/);
    const claimed = (await Promise.all([one.claim(), two.claim()])).filter(job => job !== null);
    assert.equal(claimed.length, 1);
    assert.equal(await one.retry({ ...claimed[0]!, leaseId: "wrong" }), false);
    assert.equal(await one.retry(claimed[0]!), true);
    assert.equal(await two.claim(), null);
  } finally {
    await a.query(`drop schema if exists ${schema} cascade`);
    a.release(); b.release(); await pool.end();
  }
});
