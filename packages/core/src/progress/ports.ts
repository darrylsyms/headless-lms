// progress context — ports.
// Inbound: the use-case interface the service implements.
// Outbound: the persistence contract the repository fulfils.
import type { OutboxAppender, UnitOfWork } from '../shared/ports.js';
import type { Actor } from '../shared/actor.js';
import type { CourseManagementService } from '../content/index.js';
import type { ProgressRecord } from './model.js';
import type { ProgressTarget, ReportProgressInput } from './types.js';

// Inbound port (use cases the service exposes).
export interface ProgressService {
  /** Process a usage report: ensure the record, apply position, evaluate
   *  completion (activity rule, then module/course against current structure),
   *  emit events. Returns the activity's record after the decision. The actor
   *  reports on themselves. */
  report(input: ReportProgressInput, actor: Actor): Promise<ProgressRecord>;
  recordView(activityId: string, actor: Actor): Promise<void>;
  listRecentViews(actor: Actor): Promise<RecentActivityView[]>;
  listAllSaved(actor: Actor): Promise<SavedActivityView[]>;
  removeSaved(activityId: string, actor: Actor): Promise<void>;
  listSaved(courseId: string, actor: Actor): Promise<string[]>;
  setSaved(courseId: string, activityId: string, saved: boolean, actor: Actor): Promise<void>;
  /** Fetch the record for a single (student, target), or null. */
  get(orgId: string, target: ProgressTarget): Promise<ProgressRecord | null>;
  /** Records for a set of target ids — the read the reporting layer composes. */
  listByTargets(orgId: string, orgUserId: string, targetIds: string[]): Promise<ProgressRecord[]>;
}

export type SavedActivityView = { activityId: string; courseId: string; title: string; kind: 'lesson' | 'song' | 'insider'; thumbnailUrl: string | null; accessible: boolean };
export type RecentActivityView = { activityId: string; courseId: string; title: string; kind: 'lesson' | 'song' | 'insider'; thumbnailUrl: string | null; viewedAt: string; accessible: boolean };

// Outbound port (persistence contract the repository fulfils).
export interface ProgressRepository {
  recordView(orgId: string, orgUserId: string, activityId: string): Promise<void>;
  listRecentViews(orgId: string, orgUserId: string): Promise<{ activityId: string; viewedAt: Date }[]>;
  listSavedIds(orgId: string, orgUserId: string): Promise<string[]>;
  savedAmong(orgId: string, orgUserId: string, activityIds: string[]): Promise<string[]>;
  setSaved(orgId: string, orgUserId: string, activityId: string, saved: boolean): Promise<void>;
  /** Conflict-safe insert. null = lost a concurrent-insert race (unique key already taken). */
  insert(orgId: string, record: ProgressRecord): Promise<ProgressRecord | null>;
  /** Scoped to the org — returns the record for the unique (student, target) key, or null. */
  findByTarget(orgId: string, target: ProgressTarget): Promise<ProgressRecord | null>;
  /** All of the student's records whose targetId is in the set. `forUpdate` takes tx-scoped
   *  row locks (ordered) to serialize concurrent reports for the same student+course. */
  findByTargets(
    orgId: string,
    orgUserId: string,
    targetIds: string[],
    opts?: { forUpdate?: boolean },
  ): Promise<ProgressRecord[]>;
  update(
    orgId: string,
    id: string,
    patch: Partial<Pick<ProgressRecord, 'position' | 'completedAt'>>,
  ): Promise<ProgressRecord | null>;
}

/** Access is resolved by entitlements — a report is only taken from a student
 *  who can open the course. */
export interface ContentAccessReader {
  hasAccess(orgId: string, orgUserId: string, contentId: string): Promise<boolean>;
}

export type CourseReader = Pick<
  CourseManagementService,
  'getInsiderFeed' | 'getActivity' | 'findCourse' | 'listCourseModules' | 'listCourseActivities'
>;

export interface SystemActors {
  systemActor(orgId: string): Actor;
}

/** Writes that emit events run through this scope so row + outbox entry commit
 *  in one transaction. */
export interface ProgressWriteScope {
  progress: ProgressRepository;
  outbox: OutboxAppender;
}
export type ProgressUnitOfWork = UnitOfWork<ProgressWriteScope>;
