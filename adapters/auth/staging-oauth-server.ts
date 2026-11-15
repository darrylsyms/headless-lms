import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import { genericOAuth, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as authSchema from "../db/src/schema/better-auth.js";
import { provisionVerifiedStagingIdentity } from "../db/staging-identity-provision.js";
import { verifyStagingIdentity } from "../db/staging-verified-identity.js";
import { localReturnDestination } from "../db/staging-browser-return.js";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "8005" || databaseUrl.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const clientId = process.env.FRETWISE_STAGING_OIDC_CLIENT_ID ?? "";
const clientSecret = process.env.FRETWISE_STAGING_OIDC_CLIENT_SECRET ?? "";
const secret = process.env.BETTER_AUTH_SECRET ?? "";
if (!clientId || !clientSecret || !secret) {throw new Error("Local test credentials are required.");}
const dbRequire = createRequire(new URL("../db/package.json", import.meta.url));
const pg = dbRequire("pg");
const josePath = createRequire(createRequire(import.meta.url).resolve("better-auth")).resolve("jose");
const { createRemoteJWKSet, decodeJwt } = await import(pathToFileURL(josePath).href);
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const discoveryURL = `${issuer}/.well-known/openid-configuration`;
const discovery = await fetch(discoveryURL, { redirect: "error", signal: AbortSignal.timeout(15000) });
if (!discovery.ok) {throw new Error("Staging discovery failed.");}
const metadata = await discovery.json();
if (metadata.issuer !== issuer || metadata.authorization_endpoint !== `${issuer}/oauth/authorize` ||
    metadata.token_endpoint !== `${issuer}/oauth/token` || metadata.jwks_uri !== `${issuer}/oauth/jwks`)
  {throw new Error("Unexpected staging identity configuration.");}
const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 2 });
const db = drizzle(pool);
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const startPath = "/start";
let accountId: string | undefined;
let userId: string | undefined;
const sessionIds: string[] = [];
let started = false;
let callbackStarted = false;
let expectedState: string | null = null;
let closed = false;
const auth = betterAuth({
  baseURL: "http://localhost:8017", secret,
  trustedOrigins: ["http://localhost:8017", "http://localhost:3020"],
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  account: { accountLinking: { enabled: false, disableImplicitLinking: true } },
  session: { expiresIn: 120, cookieCache: { enabled: false } },
  advanced: { defaultCookieAttributes: { sameSite: "lax", secure: false, httpOnly: true } },
  databaseHooks: { session: { create: {
    before: async (session) => {
      if (!userId || session.userId !== userId) {return false;}
      return { data: { ...session, activeOrganizationId: orgId } };
    },
    after: async (session) => { sessionIds.push(session.id); process.stdout.write("LMS authentication created the test member session.\n"); },
  } } },
  plugins: [organization(), genericOAuth({ config: [{
    providerId: "fretwise-wordpress-staging", clientId, clientSecret,
    discoveryUrl: discoveryURL, requireIdTokenVerification: true,
    redirectURI: "http://localhost:8017/callback", scopes: ["openid"],
    authentication: "basic", disableSignUp: true,
    getUserInfo: async (tokens) => {
      if (!tokens.idToken) {return null;}
      const payload = decodeJwt(tokens.idToken);
      if (typeof payload.nonce !== "string") {return null;}
      const verified = await verifyStagingIdentity(tokens.idToken, createRemoteJWKSet(new URL(metadata.jwks_uri)), clientId, payload.nonce);
      if (verified.subject !== "23003227") {return null;}
      const result = await db.transaction(async (tx) => {
        const before = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id = '23003227'`);
        if (before.rows.length) {throw new Error("An existing staging account needs review.");}
        const member = await provisionVerifiedStagingIdentity(tx, verified);
        if (member.created || member.orgUserId !== "orm_3M1piONtzjSRhD10QdWPIYYEcYz") {throw new Error("Unexpected test member.");}
        const accounts = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id = '23003227' and user_id = ${member.authUserId}`);
        const users = await tx.execute(sql`select email, name from ba_user where id = ${member.authUserId}`);
        if (accounts.rows.length !== 1 || users.rows.length !== 1) {throw new Error("Test identity is ambiguous.");}
        return { member, accountId: String(accounts.rows[0]!.id), email: String(users.rows[0]!.email), name: String(users.rows[0]!.name) };
      });
      accountId = result.accountId;
      userId = result.member.authUserId;
      return { id: verified.subject, sub: verified.subject, email: result.email, emailVerified: false, name: result.name };
    },
  }] })],
  telemetry: { enabled: false },
});
const handler = toNodeHandler(auth);
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.headers.host !== "localhost:8017") {return res.writeHead(404).end();}
  const request = new URL(req.url ?? "/", "http://localhost:8017");
  if (request.pathname === startPath && req.method === "GET" && !started) {
    started = true;
    try {
      if (request.searchParams.getAll("returnTo").length > 1) {throw new Error("Invalid return destination.");}
      const callbackURL = localReturnDestination(request.searchParams.get("returnTo"));
      const result = await auth.handler(new Request("http://localhost:8017/api/auth/sign-in/social", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:8017" },
        body: JSON.stringify({ provider: "fretwise-wordpress-staging", callbackURL }),
      }));
      const body = await result.json() as { url?: string };
      if (!result.ok || !body.url || !body.url.startsWith(`${issuer}/oauth/authorize?`)) {throw new Error("Cannot start staging sign-in.");}
      expectedState = new URL(body.url).searchParams.get("state");
      if (!expectedState) {throw new Error("The sign-in state is missing.");}
      res.setHeader("Set-Cookie", result.headers.getSetCookie());
      return res.writeHead(302, { Location: body.url }).end();
    } catch (error) {
      process.stderr.write(`Unable to start staging sign-in: ${error instanceof Error ? error.message : "unknown"}\n`);
      return res.writeHead(500).end("Unable to start the sign-in test.");
    }
  }
  if (request.pathname === "/callback" && req.method === "GET") {
    if (!expectedState || request.searchParams.getAll("state").length !== 1 || request.searchParams.get("state") !== expectedState)
      {return res.writeHead(400).end("Invalid sign-in response.");}
    if (callbackStarted) {return res.writeHead(409).end("This sign-in response was already received.");}
    callbackStarted = true;
    req.url = `/api/auth/callback/fretwise-wordpress-staging${request.search}`;
    res.once("finish", () => process.stdout.write(`LMS authentication callback returned ${res.statusCode}.\n`));
    return handler(req, res);
  }
  return res.writeHead(404).end();
});
const shutdown = async () => {
  if (closed) {return;}
  closed = true;
  server.close();
  try {
    for (const id of sessionIds) {await db.execute(sql`delete from ba_session where id = ${id}`);}
    if (accountId) {await db.execute(sql`delete from ba_account where id = ${accountId}`);}
  } finally { await pool.end(); }
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
setTimeout(() => { void shutdown(); }, 300000).unref();
server.listen(8017, "127.0.0.1", () => process.stdout.write(`Open the staging customer browser at http://localhost:8017${startPath}\n`));
