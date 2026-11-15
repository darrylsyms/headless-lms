import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { purchaseSyncLedgers } from "../schema/integrations.js";

type Key = { orgId: string; orgUserId: string; integrationId: string };
type State = NonNullable<typeof purchaseSyncLedgers.$inferInsert.state>;

export class PurchaseSyncLedgerRepository {
  constructor(private readonly db: DbExecutor) {}

  async get(key: Key): Promise<{ revision: number; state: State | null } | null> {
    const [row] = await this.db
      .select({ revision: purchaseSyncLedgers.revision, state: purchaseSyncLedgers.state })
      .from(purchaseSyncLedgers)
      .where(
        and(
          eq(purchaseSyncLedgers.orgId, key.orgId),
          eq(purchaseSyncLedgers.orgUserId, key.orgUserId),
          eq(purchaseSyncLedgers.integrationId, key.integrationId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async initialize(key: Key): Promise<void> {
    await this.db.insert(purchaseSyncLedgers).values(key).onConflictDoNothing();
  }

  async replace(key: Key, expectedRevision: number, state: State): Promise<boolean> {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2147483647
    )
      {throw new Error("Invalid ledger revision.");}
    const [row] = await this.db
      .update(purchaseSyncLedgers)
      .set({ revision: sql`${purchaseSyncLedgers.revision} + 1`, state })
      .where(
        and(
          eq(purchaseSyncLedgers.orgId, key.orgId),
          eq(purchaseSyncLedgers.orgUserId, key.orgUserId),
          eq(purchaseSyncLedgers.integrationId, key.integrationId),
          eq(purchaseSyncLedgers.revision, expectedRevision),
        ),
      )
      .returning({ revision: purchaseSyncLedgers.revision });
    return row !== undefined;
  }
}
