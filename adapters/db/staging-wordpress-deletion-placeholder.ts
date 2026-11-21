import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "./src/client.js";
import { DELETED_AUTHOR_USER_ID } from "./src/deleted-author.js";

export async function ensureDeletedAuthor(tx: Tx, orgId: string): Promise<string> {
  if (!orgId) throw new Error("Organization is required.");
  const orgUserId = `deleted_author_${createHash("sha256").update(orgId).digest("hex")}`;
  await tx.execute(sql`insert into users (id,email,first_name,last_name) values (${DELETED_AUTHOR_USER_ID},'deleted-author@invalid','Deleted','member') on conflict do nothing`);
  const user = await tx.execute(sql`select id from users where id=${DELETED_AUTHOR_USER_ID} and email='deleted-author@invalid' and external_id is null and first_name='Deleted' and last_name='member' for update`);
  if (user.rows.length !== 1) throw new Error("Deleted-member placeholder identity conflict.");
  await tx.execute(sql`delete from user_profiles where user_id=${DELETED_AUTHOR_USER_ID}`);
  await tx.execute(sql`insert into org_users (org_id,id,user_id,status) values (${orgId},${orgUserId},${DELETED_AUTHOR_USER_ID},'invited') on conflict do nothing`);
  const member = await tx.execute(sql`select id from org_users where org_id=${orgId} and id=${orgUserId} and user_id=${DELETED_AUTHOR_USER_ID} and status='invited' for update`);
  if (member.rows.length !== 1) throw new Error("Deleted-member placeholder membership conflict.");
  return orgUserId;
}
