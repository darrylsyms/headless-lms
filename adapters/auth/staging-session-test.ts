import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { provisionVerifiedStagingIdentity } from "../db/staging-identity-provision.js";
import { verifyStagingIdentity } from "../db/staging-verified-identity.js";
import { createLocalMemberSession, exerciseLocalMemberSession } from "./staging-member-session.js";
import { createContainer } from "../../packages/server/dist/index.js";
import { loadServerConfig } from "../../apps/api/src/config.js";

const dbRequire = createRequire(new URL("../db/package.json", import.meta.url));
const pg = dbRequire("pg");
const josePath = createRequire(createRequire(import.meta.url).resolve("better-auth")).resolve("jose");
const { generateKeyPair, SignJWT } = await import(pathToFileURL(josePath).href);
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "8005" || databaseUrl.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {throw new Error("The local authentication secret is required.");}
const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 2 });
const db = drizzle(pool);
let insertedAccountId: string | undefined;
try {
  const before = await db.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging' and account_id = '23003227'`);
  if (before.rows.length > 1) {throw new Error("The staging identity is ambiguous.");}
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ iss: issuer, sub: "23003227", aud: "local-test", nonce: "local-nonce",
    iat: now, exp: now + 60 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
  const identity = await verifyStagingIdentity(token, publicKey, "local-test", "local-nonce");
  const provisioned = await db.transaction(async (tx) => {
    const member = await provisionVerifiedStagingIdentity(tx, identity);
    const inserted = await tx.execute(sql`select id from ba_account where provider_id = 'fretwise-wordpress-staging'
      and account_id = '23003227' and user_id = ${member.authUserId}`);
    assert.equal(inserted.rows.length, 1);
    return { member, accountId: String(inserted.rows[0]!.id) };
  });
  const { member } = provisioned;
  if (before.rows.length === 0) {insertedAccountId = provisioned.accountId;}
  else {assert.equal(provisioned.accountId, before.rows[0]!.id);}
  assert.equal(member.created, false);
  await exerciseLocalMemberSession(db, member, secret);
  await assert.rejects(createLocalMemberSession(db, { ...member, authUserId: "wrong-user" }, secret));
  const browserSession = await createLocalMemberSession(db, member, secret, true);
  try {
    assert.ok(browserSession.cookies.some((cookie) => cookie.includes("HttpOnly") && cookie.includes("Max-Age=120")));
    const response = await fetch("http://localhost:8000/api/auth/get-session", { headers: { cookie: browserSession.cookie } });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { user?: { id?: string } }).user?.id, member.authUserId);
    const cacheCookie = browserSession.cookies.find((cookie) => cookie.startsWith("better-auth.session_data="))?.split(";")[0];
    assert.ok(cacheCookie);
    const sessionWithCache = `${browserSession.cookie}; ${cacheCookie}`;
    const dashboard = await fetch("http://localhost:3020/dashboard", { headers: { cookie: browserSession.cookie }, redirect: "manual" });
    assert.equal(dashboard.status, 200);
    const courseId = "crs_3LxuK59VqScYag90ed9Sa64Pdjx";
    const courseURL = `http://localhost:8000/api/member/courses/${courseId}`;
    assert.equal((await fetch(courseURL, { headers: { cookie: browserSession.cookie } })).status, 404);
    const container = await createContainer(loadServerConfig());
    const actor = container.organizations.systemActor(member.orgId);
    const beforeGrant = await container.entitlements.list({ page: 1, pageSize: 10, orgUserId: member.orgUserId, contentId: courseId }, actor);
    if (beforeGrant.total !== 1 || beforeGrant.rows[0]?.id !== "ent_3M5mpdySvjVKH2h0cKZEoz9TtoZ" ||
        beforeGrant.rows[0]?.status !== "revoked" || beforeGrant.rows[0]?.source !== "automation" ||
        await container.entitlements.hasAccess(member.orgId, member.orgUserId, courseId))
      {throw new Error("The local test grant changed; review before testing access.");}
    const restoreGrant = async () => {
      const afterGrant = await container.entitlements.list({ page: 1, pageSize: 10, orgUserId: member.orgUserId, contentId: courseId }, actor);
      if (afterGrant.total !== 1 || afterGrant.rows[0]?.id !== beforeGrant.rows[0].id || afterGrant.rows[0]?.source !== "automation")
        {throw new Error("The local test grant changed unexpectedly; cleanup needs review.");}
      if (afterGrant.rows[0].status === "active") {await container.entitlements.revoke({ orgUserId: member.orgUserId, contentId: courseId }, actor);}
    };
    let attempted = false;
    try {
      attempted = true;
      const grant = await container.entitlements.grant({ orgUserId: member.orgUserId, contentId: courseId, expiresAt: null }, actor);
      assert.equal(grant.id, beforeGrant.rows[0].id);
      assert.equal((await fetch(courseURL, { headers: { cookie: browserSession.cookie } })).status, 200);
    } finally {
      if (attempted) {
        await restoreGrant();
      }
    }
    assert.equal((await fetch(courseURL, { headers: { cookie: browserSession.cookie } })).status, 404);
    const signOut = await fetch("http://localhost:8000/api/auth/sign-out", {
      method: "POST", headers: { cookie: browserSession.cookie, origin: "http://localhost:8002", "content-type": "application/json" }, body: "{}",
    });
    assert.equal(signOut.status, 200);
    assert.equal(await (await fetch("http://localhost:8000/api/auth/get-session", { headers: { cookie: sessionWithCache } })).json(), null);
    assert.equal((await fetch(courseURL, { headers: { cookie: sessionWithCache } })).status, 401);
  } finally {
    await browserSession.cleanup();
  }
  const after = await fetch("http://localhost:8000/api/auth/get-session", { headers: { cookie: browserSession.cookie } });
  assert.equal(await after.json(), null);
  const expired = await createLocalMemberSession(db, member, secret);
  try {
    await db.execute(sql`update ba_session set expires_at = now() - interval '1 minute' where id = ${expired.sessionId}`);
    assert.equal(await (await fetch("http://localhost:8000/api/auth/get-session", { headers: { cookie: expired.cookie } })).json(), null);
    assert.equal((await fetch("http://localhost:8000/api/member/courses", { headers: { cookie: expired.cookie } })).status, 401);
  } finally {
    await expired.cleanup();
  }
  process.stdout.write("PASS: local LMS session, course access, expiry and sign-out invalidation.\n");
} finally {
  if (insertedAccountId) {await db.execute(sql`delete from ba_account where id = ${insertedAccountId}`);}
  await pool.end();
}
