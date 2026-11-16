import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export class PurchaseSyncHealthRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async record(orgId: string, integrationId: string, state: "ok" | "error"): Promise<void> {
    if (!orgId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(integrationId)) {throw new Error("Invalid synchronization health key.");}
    await this.db.execute(sql`insert into purchase_sync_health (org_id,integration_id,state,checked_at) values (${orgId},${integrationId},${state},now()) on conflict (org_id,integration_id) do update set state=excluded.state,checked_at=excluded.checked_at`);
  }

  async get(orgId: string, integrationId: string): Promise<"ok" | "error" | "unknown"> {
    if (!orgId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(integrationId)) {throw new Error("Invalid synchronization health key.");}
    const result = await this.db.execute(sql`select case when checked_at < now()-interval '5 minutes' then 'unknown' else state end as state from purchase_sync_health where org_id=${orgId} and integration_id=${integrationId}`);
    const state = result.rows[0]?.state;
    return state === "ok" || state === "error" ? state : "unknown";
  }
}
