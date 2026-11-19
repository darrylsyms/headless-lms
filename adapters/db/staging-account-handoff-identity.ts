import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const organization = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";

export async function findStagingHandoffIdentity(db: NodePgDatabase, sessionRef: string): Promise<{ sessionRef: string; customerId: number } | null> {
  if (process.env.NODE_ENV === "production" || !sessionRef) { return null; }
  const result = await db.execute(sql`
    select a.account_id
    from ba_session s
    join users u on u.external_id = s.user_id
    join org_users ou on ou.user_id = u.id and ou.org_id = ${organization} and ou.status = 'active'
    join ba_account a on a.user_id = s.user_id and a.provider_id = 'fretwise-wordpress-staging'
    join wordpress_identity_snapshots w on w.user_id = u.id and w.issuer = ${issuer} and w.subject = a.account_id
    where s.id = ${sessionRef} and s.active_organization_id = ${organization} and s.expires_at > now()
  `);
  if (result.rows.length !== 1) { return null; }
  const subject = result.rows[0]?.account_id;
  if (subject !== "23003226" && subject !== "23003227") { return null; }
  return { sessionRef, customerId: Number(subject) };
}
