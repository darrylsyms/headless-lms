import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;
type Direction = "wordpress-to-lms" | "lms-to-wordpress";
const subjects = new Set(["23003226", "23003227"]);
const b64url32 = (value: string): boolean => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

// The caller must first verify both the account and the current session.
// A challenge is returned only to the coordinating server; it is not a session credential.
export class StagingSignoutChallengeStore {
  constructor(private readonly db: Queryable) {}

  async issue(subject: string, direction: Direction, sessionBinding: string, now = Date.now()): Promise<string | null> {
    if (process.env.NODE_ENV === "production" || !subjects.has(subject) || !["wordpress-to-lms", "lms-to-wordpress"].includes(direction) || !b64url32(sessionBinding) || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 60000)) return null;
    const challenge = randomBytes(32).toString("base64url");
    await this.db.query("insert into fretwise_staging_signout_challenges (challenge_hash, binding_hash, subject, direction, expires_at_ms) values ($1, $2, $3, $4, $5)", [hash(challenge), hash(sessionBinding), subject, direction, now + 60000]);
    return challenge;
  }

  async consume(challenge: string, subject: string, direction: Direction, sessionBinding: string, now = Date.now()): Promise<boolean> {
    if (process.env.NODE_ENV === "production" || !b64url32(challenge) || !subjects.has(subject) || !["wordpress-to-lms", "lms-to-wordpress"].includes(direction) || !b64url32(sessionBinding) || !Number.isSafeInteger(now) || now < 0) return false;
    const result = await this.db.query("delete from fretwise_staging_signout_challenges where challenge_hash = $1 and binding_hash = $2 and subject = $3 and direction = $4 and expires_at_ms > $5 returning challenge_hash", [hash(challenge), hash(sessionBinding), subject, direction, now]);
    return result.rowCount === 1;
  }

  async removeExpired(now = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid expiry time.");
    await this.db.query("delete from fretwise_staging_signout_challenges where expires_at_ms <= $1", [now]);
  }
}
