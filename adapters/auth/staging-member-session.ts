import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { setSessionCookie } from "better-auth/cookies";
import { organization } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import * as authSchema from "../db/src/schema/better-auth.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export async function createLocalMemberSession(db: NodePgDatabase, member: { authUserId: string; orgId: string }, secret: string, cached = false) {
  if (member.orgId !== "org_3LudhlwZcnDDRGwc8R0NGHc2jdu" || !secret)
    {throw new Error("Invalid local session test configuration.");}
  const mapped = await db.execute(sql`select u.external_id from purchase_sync_customers c
    join org_users ou on ou.org_id = c.org_id and ou.id = c.org_user_id
    join users u on u.id = ou.user_id where c.org_id = ${member.orgId}
    and c.customer_id = 23003227 and ou.status = 'active'`);
  if (mapped.rows.length !== 1 || mapped.rows[0]!.external_id !== member.authUserId)
    {throw new Error("The session does not match the permitted staging customer.");}
  let sessionId: string | undefined;
  try {
    const auth = betterAuth({
      baseURL: "http://localhost:8000", secret,
      database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
      session: { expiresIn: 120, cookieCache: { enabled: cached, maxAge: 300 } },
      advanced: { defaultCookieAttributes: { sameSite: "lax", secure: false, httpOnly: true } },
      databaseHooks: { session: { create: { before: async (session) => ({ data: { ...session, activeOrganizationId: member.orgId } }) } } },
      plugins: [organization(), {
        id: "local-only-session-test",
        endpoints: { testSession: createAuthEndpoint("/local-only-test-session", { method: "POST" }, async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(member.authUserId);
          assert.ok(user);
          const session = await ctx.context.internalAdapter.createSession(user.id);
          assert.ok(session);
          sessionId = session.id;
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        }) },
      }],
      telemetry: { enabled: false },
    });
    const response = await auth.handler(new Request("http://localhost:8000/api/auth/local-only-test-session", { method: "POST" }));
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    const cookie = cookies.find((value) => value.startsWith("better-auth.session_token="))?.split(";")[0];
    assert.ok(cookie);
    assert.ok(sessionId);
    const createdId = sessionId;
    return { cookie, cookies, sessionId: createdId, cleanup: async () => { await db.execute(sql`delete from ba_session where id = ${createdId}`); } };
  } catch (error) {
    if (sessionId) {await db.execute(sql`delete from ba_session where id = ${sessionId}`);}
    throw error;
  }
}

export async function exerciseLocalMemberSession(db: NodePgDatabase, member: { authUserId: string; orgId: string }, secret: string) {
  const { cookie, cleanup } = await createLocalMemberSession(db, member, secret);
  try {
    const memberResponse = await fetch("http://localhost:8000/api/member/courses", { headers: { cookie }, signal: AbortSignal.timeout(10000) });
    assert.equal(memberResponse.status, 200);
    const lockedCourse = await fetch("http://localhost:8000/api/member/courses/crs_3LxuK59VqScYag90ed9Sa64Pdjx", { headers: { cookie }, signal: AbortSignal.timeout(10000) });
    assert.equal(lockedCourse.status, 404);
    const sessionResponse = await fetch("http://localhost:8000/api/auth/get-session", { headers: { cookie }, signal: AbortSignal.timeout(10000) });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as { user?: { id?: string } };
    assert.equal(session.user?.id, member.authUserId);
  } finally {
    await cleanup();
  }
}
