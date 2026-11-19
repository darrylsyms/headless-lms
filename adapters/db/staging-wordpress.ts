import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { provisionVerifiedStagingIdentity } from "./staging-identity-provision.js";
import { verifyStagingIdentity } from "./staging-verified-identity.js";
import { stagingTestCustomer } from "./staging-test-customer.js";
import { readStagingWordPressProfile, storeStagingWordPressProfile } from "./staging-wordpress-profile.js";

const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const providerId = "fretwise-wordpress-staging";
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";

export async function stagingWordPressIdentity(db: NodePgDatabase) {
  const database = new URL(process.env.DATABASE_URL ?? "");
  const auth = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:8000");
  const clientId = process.env.FRETWISE_STAGING_OIDC_CLIENT_ID ?? "";
  const clientSecret = process.env.FRETWISE_STAGING_OIDC_CLIENT_SECRET ?? "";
  if (process.env.NODE_ENV === "production" || database.hostname !== "127.0.0.1" || database.port !== "8005" ||
      database.pathname !== "/fretwise_lms" || auth.origin !== "http://localhost:8000" || !clientId || !clientSecret)
    {throw new Error("WordPress staging sign-in requires the local test environment.");}
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const response = await fetch(discoveryUrl, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) {throw new Error("The staging identity provider is unavailable.");}
  const metadata = await response.json() as Record<string, unknown>;
  if (metadata.issuer !== issuer || metadata.authorization_endpoint !== `${issuer}/oauth/authorize` ||
      metadata.token_endpoint !== `${issuer}/oauth/token` || metadata.jwks_uri !== `${issuer}/oauth/jwks`)
    {throw new Error("Unexpected staging identity configuration.");}
  const authRequire = createRequire(new URL("../auth/package.json", import.meta.url));
  const josePath = createRequire(authRequire.resolve("better-auth")).resolve("jose");
  const { createRemoteJWKSet, decodeJwt } = await import(pathToFileURL(josePath).href);
  const keys = createRemoteJWKSet(new URL(String(metadata.jwks_uri)));
  const profileSync = process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC === "1";
  return {
    providerId, clientId, clientSecret, discoveryUrl,
    redirectURI: "http://localhost:8017/callback",
    scopes: profileSync ? ["openid", "profile", "email"] : ["openid"],
    getUserInfo: async (tokens: { idToken?: string; accessToken?: string }) => {
      if (!tokens.idToken) {return null;}
      const payload = decodeJwt(tokens.idToken);
      if (typeof payload.nonce !== "string") {return null;}
      const verified = await verifyStagingIdentity(tokens.idToken, keys, clientId, payload.nonce);
      const profile = profileSync ? await readStagingWordPressProfile(tokens.accessToken ?? "", verified.subject) : null;
      const fixtureEmail = stagingTestCustomer(verified.subject)?.fixtureEmail;
      const stagingIdentity = fixtureEmail && !verified.email
        ? { ...verified, email: fixtureEmail, name: "Fretwise staging test" }
        : verified;
      const result = await db.transaction(async (tx) => {
        const member = await provisionVerifiedStagingIdentity(tx, stagingIdentity);
        if (profile) {
          const people = await tx.execute(sql`select id from users where external_id = ${member.authUserId}`);
          if (people.rows.length !== 1 || typeof people.rows[0]!.id !== "string") throw new Error("The staging person is unavailable.");
          await storeStagingWordPressProfile(tx, people.rows[0]!.id, profile);
        }
        const users = await tx.execute(sql`select email, name from ba_user where id = ${member.authUserId}`);
        if (member.orgId !== orgId || users.rows.length !== 1) {throw new Error("The staging member is unavailable.");}
        return { email: String(users.rows[0]!.email), name: String(users.rows[0]!.name) };
      });
      return { id: verified.subject, sub: verified.subject, email: result.email, name: result.name, emailVerified: false };
    },
  };
}
