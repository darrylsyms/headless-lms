// progress — Drizzle repository (implements the core outbound port).
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ProgressRecord,
  ProgressRepository,
  ProgressTarget,
  ProgressTargetType,
} from "@headless-lms/core/progress";
import { progressRecords, savedActivities, viewedActivities } from "../schema/progress.js";
import type { Logger } from "@headless-lms/core/shared/ports";
import { noopLogger } from "@headless-lms/core/shared/logger";
import { translateDbErrors } from "./pg-errors.js";

type Row = typeof progressRecords.$inferSelect;

function toRecord(row: Row): ProgressRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    orgUserId: row.orgUserId,
    targetType: row.targetType as ProgressTargetType,
    targetId: row.targetId,
    startedAt: row.startedAt,
    position: row.position ?? null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleProgressRepository implements ProgressRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly logger: Logger = noopLogger,
  ) {}

  async recordView(orgId: string, orgUserId: string, activityId: string): Promise<void> {
    await this.db.insert(viewedActivities).values({ orgId, orgUserId, activityId, viewedAt: new Date() })
      .onConflictDoUpdate({ target: [viewedActivities.orgId, viewedActivities.orgUserId, viewedActivities.activityId], set: { viewedAt: new Date() } });
  }

  async listRecentViews(orgId: string, orgUserId: string): Promise<{ activityId: string; viewedAt: Date }[]> {
    return this.db.select({ activityId: viewedActivities.activityId, viewedAt: viewedActivities.viewedAt })
      .from(viewedActivities).where(and(eq(viewedActivities.orgId, orgId), eq(viewedActivities.orgUserId, orgUserId)))
      .orderBy(desc(viewedActivities.viewedAt), desc(viewedActivities.activityId)).limit(50);
  }

  async listSavedIds(orgId: string, orgUserId: string): Promise<string[]> {
    const rows = await this.db.select({ id: savedActivities.activityId }).from(savedActivities)
      .where(and(eq(savedActivities.orgId, orgId), eq(savedActivities.orgUserId, orgUserId)))
      .orderBy(desc(savedActivities.createdAt), desc(savedActivities.activityId));
    return rows.map((row) => row.id);
  }

  async savedAmong(orgId: string, orgUserId: string, activityIds: string[]): Promise<string[]> {
    if (activityIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({ id: savedActivities.activityId })
      .from(savedActivities)
      .where(
        and(
          eq(savedActivities.orgId, orgId),
          eq(savedActivities.orgUserId, orgUserId),
          inArray(savedActivities.activityId, activityIds),
        ),
      );
    return rows.map((row) => row.id);
  }

  async setSaved(
    orgId: string,
    orgUserId: string,
    activityId: string,
    saved: boolean,
  ): Promise<void> {
    if (saved) {
      await this.db
        .insert(savedActivities)
        .values({ orgId, orgUserId, activityId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(savedActivities)
        .where(
          and(
            eq(savedActivities.orgId, orgId),
            eq(savedActivities.orgUserId, orgUserId),
            eq(savedActivities.activityId, activityId),
          ),
        );
    }
  }

  async insert(orgId: string, record: ProgressRecord): Promise<ProgressRecord | null> {
    const [row] = await this.db
      .insert(progressRecords)
      .values({
        id: record.id,
        orgId,
        orgUserId: record.orgUserId,
        targetType: record.targetType,
        targetId: record.targetId,
        startedAt: new Date(record.startedAt),
        position: record.position ?? null,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        updatedAt: new Date(record.updatedAt),
      })
      .onConflictDoNothing()
      .returning();
    return row ? toRecord(row) : null;
  }

  async findByTarget(orgId: string, target: ProgressTarget): Promise<ProgressRecord | null> {
    const [row] = await this.db
      .select()
      .from(progressRecords)
      .where(
        and(
          eq(progressRecords.orgId, orgId),
          eq(progressRecords.orgUserId, target.orgUserId),
          eq(progressRecords.targetType, target.targetType),
          eq(progressRecords.targetId, target.targetId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByTargets(
    orgId: string,
    orgUserId: string,
    targetIds: string[],
    opts?: { forUpdate?: boolean },
  ): Promise<ProgressRecord[]> {
    if (targetIds.length === 0) {
      return [];
    }
    const base = this.db
      .select()
      .from(progressRecords)
      .where(
        and(
          eq(progressRecords.orgId, orgId),
          eq(progressRecords.orgUserId, orgUserId),
          inArray(progressRecords.targetId, targetIds),
        ),
      );
    // Deterministic lock order prevents deadlock between overlapping reports.
    const rows = opts?.forUpdate
      ? await base.orderBy(progressRecords.id).for("update")
      : await base;
    return rows.map(toRecord);
  }

  async update(
    orgId: string,
    id: string,
    patch: Partial<Pick<ProgressRecord, "position" | "completedAt">>,
  ): Promise<ProgressRecord | null> {
    const [row] = await this.db
      .update(progressRecords)
      .set({
        ...("position" in patch ? { position: patch.position ?? null } : {}),
        ...("completedAt" in patch
          ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }
          : {}),
      })
      .where(and(eq(progressRecords.orgId, orgId), eq(progressRecords.id, id)))
      .returning();
    return row ? toRecord(row) : null;
  }
}
translateDbErrors(DrizzleProgressRepository);
