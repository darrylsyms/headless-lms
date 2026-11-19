import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;
export class StagingSignoutNonceStore {
  constructor(private readonly db: Queryable) {}

  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    if (process.env.NODE_ENV === "production" || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) { return false; }
    const hash = createHash("sha256").update(nonce).digest("hex");
    const result = await this.db.query("insert into fretwise_staging_signout_nonces (nonce_hash, expires_at_ms) values ($1, $2) on conflict do nothing returning nonce_hash", [hash, expiresAt]);
    return result.rowCount === 1;
  }

  async removeExpired(now: number): Promise<void> {
    if (!Number.isSafeInteger(now)) { throw new Error("Invalid expiry time."); }
    await this.db.query("delete from fretwise_staging_signout_nonces where expires_at_ms <= $1", [now]);
  }
}
