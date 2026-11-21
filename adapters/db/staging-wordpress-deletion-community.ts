import { sql } from "drizzle-orm";
import type { Tx } from "./src/client.js";

export async function retainWordPressMemberContributions(tx: Tx, orgId: string, orgUserId: string, placeholderOrgUserId: string): Promise<void> {
  if (!orgId || !orgUserId || !placeholderOrgUserId || orgUserId === placeholderOrgUserId) throw new Error("Invalid deletion identities.");
  const placeholder = await tx.execute(sql`select id from org_users where org_id=${orgId} and id=${placeholderOrgUserId} for update`);
  if (placeholder.rows.length !== 1) throw new Error("Deleted-member placeholder is unavailable.");
  await tx.execute(sql`update posts set org_user_id=${placeholderOrgUserId} where org_id=${orgId} and org_user_id=${orgUserId}`);
  await tx.execute(sql`update comments set org_user_id=${placeholderOrgUserId} where org_id=${orgId} and org_user_id=${orgUserId}`);
  await tx.execute(sql`update messages set org_user_id=${placeholderOrgUserId},client_id=null where org_id=${orgId} and org_user_id=${orgUserId}`);
  await tx.execute(sql`update assets set uploaded_by=${placeholderOrgUserId} where org_id=${orgId} and uploaded_by=${orgUserId} and source='member'`);
}
