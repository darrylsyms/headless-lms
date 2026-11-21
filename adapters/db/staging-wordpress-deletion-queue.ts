import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type WordPressDeletionJob = { issuer: string; eventId: string; subject: string; leaseId: string; attempts: number };

export class StagingWordPressDeletionQueue {
  constructor(private readonly db: NodePgDatabase, private readonly issuer: string) {
    if (!issuer) throw new Error("Issuer is required.");
  }

  async enqueue(event: { issuer: string; eventId: string; subject: string }): Promise<void> {
    if (event.issuer !== this.issuer || !/^[a-zA-Z0-9_-]{16,128}$/.test(event.eventId) || !/^[1-9][0-9]{0,19}$/.test(event.subject)) throw new Error("Invalid deletion event.");
    await this.db.transaction(async tx => {
      await tx.execute(sql`insert into staging_wordpress_deletion_jobs (issuer,event_id,subject) values (${event.issuer},${event.eventId},${event.subject}) on conflict do nothing`);
      const result = await tx.execute(sql`select subject from staging_wordpress_deletion_jobs where issuer=${event.issuer} and event_id=${event.eventId}`);
      if (result.rows.length !== 1 || result.rows[0]?.subject !== event.subject) throw new Error("Deletion event conflict.");
    });
  }

  async claim(): Promise<WordPressDeletionJob | null> {
    const leaseId = randomUUID();
    const result = await this.db.execute(sql`update staging_wordpress_deletion_jobs set state='running', lease_id=${leaseId}, lease_until=now()+interval '2 minutes', attempts=attempts+1 where (issuer,event_id) = (select issuer,event_id from staging_wordpress_deletion_jobs where issuer=${this.issuer} and ((state='pending' and next_attempt_at<=now()) or (state='running' and lease_until<=now())) order by created_at for update skip locked limit 1) returning issuer,event_id,subject,attempts`);
    const row = result.rows[0];
    return row ? { issuer: String(row.issuer), eventId: String(row.event_id), subject: String(row.subject), attempts: Number(row.attempts), leaseId } : null;
  }

  async retry(job: WordPressDeletionJob): Promise<boolean> {
    const result = await this.db.execute(sql`update staging_wordpress_deletion_jobs set state='pending', next_attempt_at=now()+interval '5 minutes', lease_id=null, lease_until=null where issuer=${this.issuer} and event_id=${job.eventId} and state='running' and lease_id=${job.leaseId} and lease_until>now() returning event_id`);
    return result.rows.length === 1;
  }
}
