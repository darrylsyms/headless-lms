import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type WebhookJob = { deliveryId: string; topic: string; resourceId: number; leaseId: string; attempts: number };

export class PurchaseSyncWebhookJobsRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async enqueue(orgId: string, job: { deliveryId: string; topic: string; resourceId: number }): Promise<void> {
    if (!orgId || !/^[a-zA-Z0-9_-]{1,128}$/.test(job.deliveryId) || !["order.created", "order.updated", "subscription.created", "subscription.updated"].includes(job.topic) || !Number.isSafeInteger(job.resourceId) || job.resourceId <= 0 || job.resourceId > 2147483647) {throw new Error("Invalid webhook job.");}
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`insert into purchase_sync_webhook_jobs (org_id,delivery_id,topic,resource_id) values (${orgId},${job.deliveryId},${job.topic},${job.resourceId}) on conflict do nothing`);
      const result = await tx.execute(sql`select topic,resource_id from purchase_sync_webhook_jobs where org_id=${orgId} and delivery_id=${job.deliveryId}`);
      if (result.rows.length !== 1 || result.rows[0]?.topic !== job.topic || result.rows[0]?.resource_id !== job.resourceId) {throw new Error("Webhook delivery conflict.");}
    });
  }

  async claim(orgId: string, leaseSeconds = 120): Promise<WebhookJob | null> {
    if (!orgId || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {throw new Error("Invalid lease.");}
    const leaseId = randomUUID();
    const result = await this.db.execute(sql`update purchase_sync_webhook_jobs set state='running', lease_id=${leaseId}, lease_until=now()+(${leaseSeconds} * interval '1 second'), attempts=attempts+1 where (org_id,delivery_id) = (select org_id,delivery_id from purchase_sync_webhook_jobs where org_id=${orgId} and ((state='pending' and next_attempt_at<=now()) or (state='running' and lease_until<=now())) order by created_at for update skip locked limit 1) returning delivery_id,topic,resource_id,attempts`);
    const row = result.rows[0];
    return row ? { deliveryId: String(row.delivery_id), topic: String(row.topic), resourceId: Number(row.resource_id), attempts: Number(row.attempts), leaseId } : null;
  }

  async complete(orgId: string, job: WebhookJob): Promise<boolean> {
    const result = await this.db.execute(sql`update purchase_sync_webhook_jobs set state='done',completed_at=now(),lease_id=null,lease_until=null where org_id=${orgId} and delivery_id=${job.deliveryId} and state='running' and lease_id=${job.leaseId} and lease_until>now() returning delivery_id`);
    return result.rows.length === 1;
  }

  async retry(orgId: string, job: WebhookJob, delaySeconds: number): Promise<boolean> {
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400) {throw new Error("Invalid retry delay.");}
    const result = await this.db.execute(sql`update purchase_sync_webhook_jobs set state='pending',next_attempt_at=now()+(${delaySeconds} * interval '1 second'),lease_id=null,lease_until=null where org_id=${orgId} and delivery_id=${job.deliveryId} and state='running' and lease_id=${job.leaseId} and lease_until>now() returning delivery_id`);
    return result.rows.length === 1;
  }
}
