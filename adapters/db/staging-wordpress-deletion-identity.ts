import { sql } from "drizzle-orm";
import type { Tx } from "./src/client.js";

export async function resolveWordPressDeletionIdentity(tx: Tx, issuer: string, providerId: string, subject: string): Promise<{ userId: string; authId: string }> {
  if (!issuer || !providerId || !/^[1-9][0-9]{0,19}$/.test(subject)) throw new Error("Invalid deletion identity.");
  const result = await tx.execute(sql`select u.id as user_id, u.external_id as auth_id from wordpress_identity_snapshots s join users u on u.id=s.user_id join ba_account a on a.user_id=u.external_id and a.provider_id=${providerId} and a.account_id=s.subject where s.issuer=${issuer} and s.subject=${subject} for update of u, a, s`);
  if (result.rows.length !== 1 || typeof result.rows[0]?.user_id !== "string" || typeof result.rows[0]?.auth_id !== "string") throw new Error("Deletion identity requires review.");
  const { user_id: userId, auth_id: authId } = result.rows[0] as { user_id: string; auth_id: string };
  const accounts = await tx.execute(sql`select id from ba_account where user_id=${authId}`);
  const owners = await tx.execute(sql`select id from organizations where owner_id=${userId}`);
  if (accounts.rows.length !== 1 || owners.rows.length !== 0) throw new Error("Deletion identity requires review.");
  return { userId, authId };
}
