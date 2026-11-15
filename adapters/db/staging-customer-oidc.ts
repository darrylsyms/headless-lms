import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { provisionVerifiedStagingIdentity } from "./staging-identity-provision.js";
import { verifyStagingIdentity } from "./staging-verified-identity.js";
import { exerciseLocalMemberSession } from "../auth/staging-member-session.js";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "8005" || databaseUrl.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const clientId = process.env.FRETWISE_STAGING_OIDC_CLIENT_ID ?? "";
const clientSecret = process.env.FRETWISE_STAGING_OIDC_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {throw new Error("Temporary staging OIDC client credentials are required.");}

const authRequire = createRequire(new URL("../auth/package.json", import.meta.url));
const josePath = createRequire(authRequire.resolve("better-auth")).resolve("jose");
const { createRemoteJWKSet } = await import(pathToFileURL(josePath).href);
const origin = "https://getfretwise-cydd.1wp.site";
const issuer = `${origin}/wenisch-tech/keystone-oidc`;
const redirectUri = "http://localhost:8017/callback";
const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(15000) });
if (!discovery.ok) {throw new Error("Staging OIDC discovery failed.");}
const metadata = await discovery.json();
if (metadata.issuer !== issuer || metadata.authorization_endpoint !== `${issuer}/oauth/authorize` ||
    metadata.token_endpoint !== `${issuer}/oauth/token` || metadata.jwks_uri !== `${issuer}/oauth/jwks`)
  {throw new Error("Unexpected staging OIDC configuration.");}
const state = randomBytes(32).toString("base64url");
const nonce = randomBytes(32).toString("base64url");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const startPath = `/${randomBytes(24).toString("hex")}`;
const authorize = new URL(metadata.authorization_endpoint);
for (const [key, value] of Object.entries({ response_type: "code", client_id: clientId,
  redirect_uri: redirectUri, scope: "openid", state, nonce, code_challenge: challenge,
  code_challenge_method: "S256" })) {authorize.searchParams.set(key, value);}
const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 1 });
const db = drizzle(pool);
let used = false;
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET" || req.headers.host !== "localhost:8017" || used)
    {return res.writeHead(404).end();}
  const request = new URL(req.url ?? "/", redirectUri);
  if (request.pathname === startPath) {return res.writeHead(302, { Location: authorize.toString() }).end();}
  if (request.pathname !== "/callback") {return res.writeHead(404).end();}
  used = true;
  try {
    if (request.searchParams.getAll("state").length !== 1 || request.searchParams.get("state") !== state ||
        request.searchParams.getAll("code").length !== 1 || request.searchParams.has("error"))
      {throw new Error("Authorization response rejected.");}
    const code = request.searchParams.get("code");
    if (!code) {throw new Error("Authorization code missing.");}
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri,
        code_verifier: verifier }),
    });
    if (!tokenResponse.ok) {throw new Error("Staging token exchange failed.");}
    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== "string") {throw new Error("Identity token missing.");}
    const identity = await verifyStagingIdentity(tokens.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), clientId, nonce);
    if (identity.subject !== "23003227")
      {throw new Error("Unexpected test customer identity.");}
    const orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz";
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {throw new Error("The local authentication secret is required.");}
    let accountId: string | undefined;
    try {
      const linked = await db.transaction(async (tx) => {
        const before = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id = '23003227'`);
        if (before.rows.length) {throw new Error("An existing staging identity needs review.");}
        const linked = await provisionVerifiedStagingIdentity(tx, identity);
        assert.equal(linked.orgUserId, orgUserId);
        assert.equal(linked.created, false);
        const accounts = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging'
          and account_id = '23003227' and user_id = ${linked.authUserId}`);
        assert.equal(accounts.rows.length, 1);
        return { ...linked, accountId: String(accounts.rows[0]!.id) };
      });
      accountId = linked.accountId;
      await exerciseLocalMemberSession(db, linked, secret);
    } finally {
      if (accountId) {await db.execute(sql`delete from ba_account where id = ${accountId}`);}
    }
    res.end("PASS: the staging customer matched their local account, the LMS accepted a test session, and an ungranted course remained locked. Temporary local records were removed.");
    process.stdout.write("PASS: staging identity matched, local session accepted, ungranted course denied; temporary records removed.\n");
  } catch {
    res.writeHead(400).end("The staging identity test failed. Check local test cleanup before retrying.");
    process.stderr.write("Staging customer identity test failed.\n");
  } finally {
    server.close();
    await pool.end();
  }
});
const deadline = setTimeout(() => {
  server.close();
  void pool.end();
  process.stderr.write("Staging identity test expired.\n");
}, 5 * 60 * 1000);
server.once("close", () => clearTimeout(deadline));
server.listen(8017, "127.0.0.1", () => process.stdout.write(`Open in the staging customer browser: http://localhost:8017${startPath}\n`));
