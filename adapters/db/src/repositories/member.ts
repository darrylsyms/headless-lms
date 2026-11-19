// member — Drizzle read repo (implements the reporting/member outbound port).
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  DirectoryQuery,
  DirectoryRow,
  EventAttendeeRow,
  EventReader,
  MemberReportRepository,
} from "@headless-lms/core/reporting/member";
import type { MemberEventsQuery, Page } from "@headless-lms/core/types";
import type { EventFaces } from "@headless-lms/core/reporting/events";
import {
  contentAccess,
  orgUsers,
  spaceMembers,
  spaces,
  userProfiles,
  users,
} from "../schema/index.js";
import type { Logger } from "@headless-lms/core/shared/ports";
import { noopLogger } from "@headless-lms/core/shared/logger";
import { translateDbErrors } from "./pg-errors.js";
import { DrizzleAdminRepository } from "./admin.js";
import { communityMember, communityPublished, oneOf } from "./grant-covers.js";
import {
  directEventGrantIds,
  eventAttendeePage,
  eventFacesFor,
  memberEventIds,
} from "./event-reports.js";

function personColumns(orgId: string) {
  return {
    orgUserId: orgUsers.id,
    userId: orgUsers.userId,
    displayName: sql<
      string | null
    >`coalesce(nullif(trim(${userProfiles.displayName}), ''), nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), ''))`,
    headline: userProfiles.headline,
    bio: userProfiles.bio,
    imageAssetId: sql<
      string | null
    >`case when ${userProfiles.imageAssetOrgId} = ${orgId} then ${userProfiles.imageAssetId} end`,
  };
}

export class DrizzleMemberRepository implements MemberReportRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly logger: Logger = noopLogger,
  ) {}

  async profileBadge(orgId: string, orgUserId: string): Promise<"subscriber" | "student" | null> {
    const status = await new DrizzleAdminRepository(this.db).getStudent(orgId, orgUserId);
    if (!status || status.wooSyncHealth !== "ok" || status.wooSyncIssues?.length || status.wooSubscribed == null) {return null;}
    if (status.wooSubscribed) {return "subscriber";}
    const result = await this.db.execute(sql`
      select 1 from purchase_sync_ledgers l
      join entitlements e on e.org_id=l.org_id and e.org_user_id=l.org_user_id
        and e.id=l.state->'managed'->'course'->>'id'
        and e.xmin::text=l.state->'managed'->'course'->>'version'
        and e.source='integration:' || l.integration_id
      where l.org_id=${orgId} and l.org_user_id=${orgUserId}
        and e.content_id is not null and e.status='active' and (e.expires_at is null or e.expires_at > now())
        and case when coalesce(l.state->>'capturedAt', '') ~ '^[0-9]{1,16}$' then (l.state->>'capturedAt')::numeric between extract(epoch from now() - interval '5 minutes') * 1000 and extract(epoch from now()) * 1000 else false end
        and case when jsonb_typeof(l.state->'known'->'course') = 'array' then jsonb_array_length(l.state->'known'->'course') > 0 else false end
      limit 1
    `);
    return result.rows.length ? "student" : null;
  }

  async profilePerson(orgId: string, communityId: string, orgUserId: string, readerIds: string[], staff: boolean): Promise<(DirectoryRow & { extra: unknown }) | null> {
    const [row] = await this.db.select({ ...personColumns(orgId), extra: userProfiles.extra }).from(orgUsers)
      .leftJoin(userProfiles, eq(userProfiles.userId, orgUsers.userId))
      .leftJoin(users, eq(users.id, orgUsers.userId))
      .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.id, orgUserId), eq(orgUsers.status, "active"), staff ? undefined : communityMember(sql`${orgUsers.orgId}`, sql`${orgUsers.id}`, sql`${communityId}`, readerIds))).limit(1);
    return row ?? null;
  }

  async directory(
    orgId: string,
    communityId: string,
    query: DirectoryQuery,
    readerIds: string[],
  ): Promise<Page<DirectoryRow>> {
    const columns = personColumns(orgId);
    const q = query.search?.trim();
    const where = and(
      eq(orgUsers.orgId, orgId),
      communityMember(sql`${orgUsers.orgId}`, sql`${orgUsers.id}`, sql`${communityId}`, readerIds),
      q ? ilike(columns.displayName, `%${q}%`) : undefined,
    );
    const rows = await this.db
      .select(columns)
      .from(orgUsers)
      .leftJoin(userProfiles, eq(userProfiles.userId, orgUsers.userId))
      .leftJoin(users, eq(users.id, orgUsers.userId))
      .where(where)
      .orderBy(asc(userProfiles.displayName), asc(orgUsers.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(orgUsers)
      .leftJoin(userProfiles, eq(userProfiles.userId, orgUsers.userId))
      .leftJoin(users, eq(users.id, orgUsers.userId))
      .where(where);
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  async people(orgId: string, orgUserIds: string[]): Promise<DirectoryRow[]> {
    if (orgUserIds.length === 0) {
      return [];
    }
    return this.db
      .select(personColumns(orgId))
      .from(orgUsers)
      .leftJoin(userProfiles, eq(userProfiles.userId, orgUsers.userId))
      .leftJoin(users, eq(users.id, orgUsers.userId))
      .where(and(eq(orgUsers.orgId, orgId), inArray(orgUsers.id, orgUserIds)));
  }

  eventAttendees(
    orgId: string,
    eventId: string,
    page: { page: number; pageSize: number },
  ): Promise<Page<EventAttendeeRow>> {
    return eventAttendeePage(this.db, orgId, eventId, page);
  }

  eventFaces(
    orgId: string,
    eventIds: string[],
    limit: number,
  ): Promise<Record<string, EventFaces>> {
    return eventFacesFor(this.db, orgId, eventIds, limit);
  }

  directEventGrants(orgId: string, orgUserId: string, eventIds: string[]): Promise<string[]> {
    return directEventGrantIds(this.db, orgId, orgUserId, eventIds);
  }

  events(
    orgId: string,
    query: MemberEventsQuery,
    reader: EventReader,
    now: Date,
  ): Promise<Page<string>> {
    return memberEventIds(this.db, orgId, query, reader, now);
  }

  async spaceMemberCounts(
    orgId: string,
    communityId: string,
    excluding: string[],
  ): Promise<Record<string, number>> {
    const holders = this.db.$with("holders").as(
      this.db
        .selectDistinct({ orgUserId: contentAccess.orgUserId })
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.orgId, orgId),
            eq(contentAccess.contentId, communityId),
            communityPublished(sql`${orgId}`, sql`${communityId}`),
          ),
        ),
    );
    const seated = this.db.$with("seated").as(
      this.db
        .select({
          spaceId: spaceMembers.spaceId,
          count: sql<number>`cast(count(*) as int)`.as("count"),
        })
        .from(spaceMembers)
        .innerJoin(holders, eq(holders.orgUserId, spaceMembers.orgUserId))
        .where(
          and(
            eq(spaceMembers.orgId, orgId),
            eq(spaceMembers.communityId, communityId),
            eq(spaceMembers.status, "active"),
            excluding.length > 0
              ? sql`not ${oneOf(sql`${spaceMembers.orgUserId}`, excluding)}`
              : undefined,
          ),
        )
        .groupBy(spaceMembers.spaceId),
    );
    const rows = await this.db
      .with(holders, seated)
      .select({
        spaceId: spaces.id,
        count: sql<number>`case when ${spaces.accessRule} = 'all_members' then (select cast(count(*) as int) from ${holders}) else coalesce(${sql.identifier("seated")}.${sql.identifier("count")}, 0) end`,
      })
      .from(spaces)
      .leftJoin(seated, eq(seated.spaceId, spaces.id))
      .where(and(eq(spaces.orgId, orgId), eq(spaces.communityId, communityId)));
    return Object.fromEntries(rows.map((row) => [row.spaceId, Number(row.count)]));
  }
}
translateDbErrors(DrizzleMemberRepository);
