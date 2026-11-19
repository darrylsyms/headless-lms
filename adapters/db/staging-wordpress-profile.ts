import { sql } from "drizzle-orm";
import type { Tx } from "./src/client.js";

const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const userInfoUrl = `${issuer}/oauth/userinfo`;

export type WordPressProfile = { subject: string; username?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null };

export async function readStagingWordPressProfile(accessToken: string, subject: string, fetcher: typeof fetch = fetch): Promise<WordPressProfile> {
  if (!accessToken || !/^[1-9]\d*$/.test(subject)) throw new Error("Invalid staging identity.");
  const response = await fetcher(userInfoUrl, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("WordPress profile is unavailable.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid WordPress profile.");
  const claims = value as Record<string, unknown>;
  if (claims.sub !== subject) throw new Error("WordPress profile subject mismatch.");
  const field = (key: string): string | null | undefined => {
    const item = claims[key];
    if (item === undefined) return undefined;
    if (item === null) return null;
    if (typeof item !== "string" || item.length > 320 || /[\r\n\0]/.test(item)) throw new Error("Invalid WordPress profile field.");
    return item.trim() || null;
  };
  return { subject, username: field("preferred_username"), firstName: field("given_name"), lastName: field("family_name"), email: field("email") };
}

export async function storeStagingWordPressProfile(tx: Tx, userId: string, profile: WordPressProfile): Promise<void> {
  const matches = await tx.execute(sql`select u.id from users u join ba_account a on a.user_id = u.external_id where u.id = ${userId} and a.provider_id = 'fretwise-wordpress-staging' and a.account_id = ${profile.subject}`);
  if (matches.rows.length !== 1) throw new Error("WordPress profile is not linked to this member.");
  await tx.execute(sql`insert into wordpress_identity_snapshots (issuer, subject, user_id, username, first_name, last_name, email)
    values (${issuer}, ${profile.subject}, ${userId}, ${profile.username ?? null}, ${profile.firstName ?? null}, ${profile.lastName ?? null}, ${profile.email ?? null})
    on conflict (issuer, subject) do update set
      username = case when ${profile.username !== undefined} then excluded.username else wordpress_identity_snapshots.username end,
      first_name = case when ${profile.firstName !== undefined} then excluded.first_name else wordpress_identity_snapshots.first_name end,
      last_name = case when ${profile.lastName !== undefined} then excluded.last_name else wordpress_identity_snapshots.last_name end,
      email = case when ${profile.email !== undefined} then excluded.email else wordpress_identity_snapshots.email end,
      updated_at = now()
    where wordpress_identity_snapshots.user_id = excluded.user_id returning user_id`).then(result => {
      if (result.rows.length !== 1) throw new Error("WordPress profile identity conflict.");
    });
}
