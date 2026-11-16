import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export class PurchaseSyncFailuresRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async record(orgId: string, orgUserId: string, target: string, state: "succeeded" | "failed"): Promise<void> {
    if (!orgId || !orgUserId || !/^(snapshot|subscription|course:[a-zA-Z0-9_-]{1,128})$/.test(target)) {throw new Error("Invalid synchronization outcome.");}
    if (state === "succeeded") {
      await this.db.execute(sql`delete from purchase_sync_failures where org_id=${orgId} and org_user_id=${orgUserId} and target=${target}`);
      return;
    }
    await this.db.execute(sql`insert into purchase_sync_failures (org_id,org_user_id,target) values (${orgId},${orgUserId},${target}) on conflict (org_id,org_user_id,target) do update set attempts=purchase_sync_failures.attempts+1,last_failed_at=now()`);
  }

  async list(orgId: string): Promise<{ orgUserId: string; target: string; attempts: number; lastFailedAt: Date }[]> {
    if (!orgId) {throw new Error("Organisation required.");}
    const result = await this.db.execute(sql`select org_user_id,target,attempts,last_failed_at from purchase_sync_failures where org_id=${orgId} order by last_failed_at desc`);
    return result.rows.map((row) => ({ orgUserId: String(row.org_user_id), target: String(row.target), attempts: Number(row.attempts), lastFailedAt: new Date(String(row.last_failed_at)) }));
  }
}
