import type { Pool, PoolClient } from "pg";

type Destination = { kind: "orders" } | { kind: "subscription"; subscriptionId: number };
type HandoffRecord = { codeHash: string; browserHash: string; sessionRef: string; customerId: number; destination: Destination; expiresAt: number };
type Queryable = Pick<Pool | PoolClient, "query">;

export class StagingAccountHandoffStore {
  constructor(private readonly db: Queryable) {}

  async insert(record: HandoffRecord): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(record.codeHash) || !/^[a-f0-9]{64}$/.test(record.browserHash) || !record.sessionRef || !Number.isSafeInteger(record.expiresAt) || ![23003226, 23003227].includes(record.customerId)) { throw new Error("Invalid staging handoff."); }
    await this.db.query(`insert into fretwise_staging_account_handoffs (code_hash, browser_hash, session_ref, customer_id, destination, expires_at_ms) values ($1, $2, $3, $4, $5::jsonb, $6)`, [record.codeHash, record.browserHash, record.sessionRef, record.customerId, JSON.stringify(record.destination), record.expiresAt]);
  }

  async consume(codeHash: string, browserHash: string, now: number): Promise<HandoffRecord | null> {
    if (!/^[a-f0-9]{64}$/.test(codeHash) || !/^[a-f0-9]{64}$/.test(browserHash) || !Number.isSafeInteger(now)) { return null; }
    const result = await this.db.query(`delete from fretwise_staging_account_handoffs where code_hash = $1 and browser_hash = $2 and expires_at_ms > $3 returning code_hash, browser_hash, session_ref, customer_id, destination, expires_at_ms`, [codeHash, browserHash, now]);
    if (result.rows.length !== 1) { return null; }
    const row = result.rows[0];
    return { codeHash: row.code_hash, browserHash: row.browser_hash, sessionRef: row.session_ref, customerId: row.customer_id, destination: row.destination, expiresAt: Number(row.expires_at_ms) };
  }

  async removeExpired(now: number): Promise<void> {
    if (!Number.isSafeInteger(now)) { throw new Error("Invalid expiry time."); }
    await this.db.query(`delete from fretwise_staging_account_handoffs where expires_at_ms <= $1`, [now]);
  }
}
