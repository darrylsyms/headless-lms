import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { genId } from "@headless-lms/core/shared/id";
import { createLocalMemberSession } from "../auth/staging-member-session.js";

const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu", orgUserId = "orm_3M1piONtzjSRhD10QdWPIYYEcYz", authUserId = "usr_3M1piQB4wG1rlL84QV9me5GQWeG";
const communityId = "cmy_3LueCEjaa3FApeLpEpPvAuy7vm4", insiderId = "crs_3M1K3U8Vj1n2GrDkv8Yrt8zJex6";
const bundleId = genId("bundle"), entitlementId = genId("entitlement");
const pool = new pg.Pool({connectionString: url.toString()}), db = drizzle(pool);
let cleanupSession: (() => Promise<void>) | undefined;
try {
  const result = await createLocalMemberSession(db, {orgId, authUserId}, process.env.BETTER_AUTH_SECRET ?? "");
  cleanupSession = result.cleanup;
  const get = async (path: string) => fetch(`http://localhost:8000${path}`, {headers: {cookie: result.cookie}, signal: AbortSignal.timeout(10000)});
  const check = async (granted: boolean) => {
    const feed = await get("/api/member/insider-feed");
    const community = await get(`/api/member/communities/${communityId}/home`);
    const communityFeed = await get(`/api/member/communities/${communityId}/feed`);
    assert.equal(feed.status, granted ? 200 : 404, `Insider access (${granted})`);
    assert.equal(community.status, granted ? 200 : 404, `Community access (${granted})`);
    assert.equal(communityFeed.status, granted ? 200 : 404, `Community feed access (${granted})`);
    if (granted) {
      const config = await feed.json() as {courseId: string};
      assert.equal(config.courseId, insiderId);
      const activities = await get(`/api/member/courses/${insiderId}/activities`);
      assert.equal(activities.status, 200);
      const data = await activities.json();
      assert.ok(Array.isArray(data) && data.length > 0, "Published Insider activities are available");
      const home = await community.json() as {communityId: string; spaces: unknown[]};
      assert.equal(home.communityId, communityId);
      assert.ok(Array.isArray(home.spaces));
    }
  };
  await check(false);
  await db.transaction(async tx => {
    await tx.execute(sql`insert into bundles (org_id,id,name) values (${orgId},${bundleId},'Disposable all-access journey test')`);
    await tx.execute(sql`insert into purchase_sync_all_access_bundles (org_id,bundle_id) values (${orgId},${bundleId})`);
    await tx.execute(sql`insert into entitlements (org_id,id,org_user_id,bundle_id,status,source) values (${orgId},${entitlementId},${orgUserId},${bundleId},'active','integration:journey-test')`);
  });
  await check(true);
  await db.execute(sql`update entitlements set status='revoked' where org_id=${orgId} and id=${entitlementId} and source='integration:journey-test'`);
  await check(false);
  process.stdout.write("PASS: disposable student denied before grant, opened published Insider activities and community home and feed with all-access grant, and was denied after revocation.\n");
} finally {
  await db.transaction(async tx => {
    await tx.execute(sql`delete from entitlements where org_id=${orgId} and id=${entitlementId} and source='integration:journey-test'`);
    await tx.execute(sql`delete from purchase_sync_all_access_bundles where org_id=${orgId} and bundle_id=${bundleId}`);
    await tx.execute(sql`delete from bundles where org_id=${orgId} and id=${bundleId} and name='Disposable all-access journey test'`);
  });
  await cleanupSession?.();
  await pool.end();
}
