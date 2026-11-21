import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { resolveWordPressDeletionIdentity } from "./staging-wordpress-deletion-identity.js";
import { retainWordPressMemberContributions } from "./staging-wordpress-deletion-community.js";
import type { WordPressDeletionJob } from "./staging-wordpress-deletion-queue.js";
import { ensureDeletedAuthor } from "./staging-wordpress-deletion-placeholder.js";

export async function processStagingWordPressDeletion(
  db: NodePgDatabase,
  job: WordPressDeletionJob,
  options: { issuer: string; providerId: string; allowedSubjects: ReadonlySet<string> },
): Promise<void> {
  if (process.env.NODE_ENV === "production" || job.issuer !== options.issuer || !options.allowedSubjects.has(job.subject)) throw new Error("Deletion is not permitted.");
  await db.transaction(async tx => {
    const locked = await tx.execute(sql`select event_id from staging_wordpress_deletion_jobs where issuer=${job.issuer} and event_id=${job.eventId} and subject=${job.subject} and state='running' and lease_id=${job.leaseId} and lease_until>now() for update`);
    if (locked.rows.length !== 1) throw new Error("Deletion lease unavailable.");
    const { userId, authId } = await resolveWordPressDeletionIdentity(tx, options.issuer, options.providerId, job.subject);
    const memberships = await tx.execute(sql`select org_id,id from org_users where user_id=${userId} for update`);
    for (const row of memberships.rows) {
      const orgId = String(row.org_id), orgUserId = String(row.id);
      const placeholder = await ensureDeletedAuthor(tx, orgId);
      await retainWordPressMemberContributions(tx, orgId, orgUserId, placeholder);
      await tx.execute(sql`delete from progress_records where org_id=${orgId} and org_user_id=${orgUserId}`);
      await tx.execute(sql`delete from org_users where org_id=${orgId} and id=${orgUserId}`);
    }
    await tx.execute(sql`delete from invites where invited_by=${userId}`);
    await tx.execute(sql`delete from wordpress_identity_snapshots where user_id=${userId}`);
    await tx.execute(sql`delete from users where id=${userId}`);
    await tx.execute(sql`delete from ba_user where id=${authId}`);
    const done = await tx.execute(sql`update staging_wordpress_deletion_jobs set state='done',completed_at=now(),lease_id=null,lease_until=null where issuer=${job.issuer} and event_id=${job.eventId} and state='running' and lease_id=${job.leaseId} and lease_until>now() returning event_id`);
    if (done.rows.length !== 1) throw new Error("Deletion lease expired.");
  });
}
