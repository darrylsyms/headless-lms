import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { startLocalWooWebhookServer } from "../../../fretwise-lms-frontend/lib/server/woocommerce-webhook.js";
import { PurchaseSyncWebhookJobsRepository } from "./src/repositories/purchase-sync-webhook-jobs.js";
import { readFile } from "node:fs/promises";
import { genId } from "@headless-lms/core/shared/id";
import { createWooPurchaseReader } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reader.js";
import { reconcileMappedCourses, courseSyncIntegrationId } from "../../../fretwise-lms-frontend/lib/server/woocommerce-mapping-sync.js";
import { reconcileWooPurchases, planWooSync } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reconciliation.js";
import { actorWith } from "@headless-lms/core/organizations";
import { PurchaseSyncService } from "../../packages/core/src/entitlements/purchase-sync.js";
import { PurchaseSyncMappingsRepository } from "./src/repositories/purchase-sync-mappings.js";
import { PurchaseSyncLedgerRepository } from "./src/repositories/purchase-sync-ledger.js";
import { DrizzleEntitlementsRepository } from "./src/repositories/entitlements.js";
import { DrizzleOutboxAppender } from "./src/repositories/outbox.js";
import { createWooLmsStore } from "../../../fretwise-lms-frontend/lib/server/woocommerce-lms-store.js";
import { ProductCourseMappingsRepository } from "./src/repositories/product-course-mappings.js";
import { DrizzleAdminRepository } from "./src/repositories/admin.js";
import { DrizzleMemberRepository } from "./src/repositories/member.js";
import { DrizzleIdentityRepository } from "./src/repositories/identity.js";
import { PurchaseSyncFailuresRepository } from "./src/repositories/purchase-sync-failures.js";
import { PurchaseSyncHealthRepository } from "./src/repositories/purchase-sync-health.js";
import { createWooGeneralStores } from "./woocommerce-general-stores.js";
import { reconcileWooAccounts } from "../../../fretwise-lms-frontend/lib/server/woocommerce-account-sync.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("product mappings in PostgreSQL", () => {
  let pool: pg.Pool;
  let repo: ProductCourseMappingsRepository;
  const org = genId("organization");
  const user = genId("user");
  const course = genId("course");
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new ProductCourseMappingsRepository(drizzle(pool));
    await pool.query("insert into users (id,email) values ($1,$2)", [user, `${user}@test.invalid`]);
    await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,$1,$1,$2)", [org, user]);
    await pool.query("insert into content_items (org_id,id,type) values ($1,$2,'course')", [org, course]);
    await pool.query("insert into courses (org_id,id,title,slug,category) values ($1,$2,$2,$2,'')", [org, course]);
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query("delete from purchase_sync_webhook_jobs where org_id=$1", [org]);
    await pool.query("delete from settings where org_id=$1", [org]);
    await pool.query("delete from courses where org_id=$1", [org]);
    await pool.query("delete from content_items where org_id=$1", [org]);
    await pool.query("delete from organizations where id=$1", [org]);
    await pool.query("delete from users where id=$1", [user]);
    await pool.end();
  });
  it("persists a signed webhook across listener restarts and retries", async () => {
    const jobs = new PurchaseSyncWebhookJobsRepository(drizzle(pool));
    const secret = "staging-test-secret-that-is-long-enough";
    const listener = await startLocalWooWebhookServer({ secret, port: 0, enqueue: (job) => jobs.enqueue(org, job) });
    const body = JSON.stringify({ id: 42 });
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    const endpoint = `http://127.0.0.1:${listener.port}/woocommerce-webhook`;
    const headers = { "x-wc-webhook-signature": signature, "x-wc-webhook-topic": "order.updated", "x-wc-webhook-delivery-id": "persisted-test" };
    try {
      expect((await fetch(endpoint, { method: "POST", headers: { ...headers, "x-wc-webhook-signature": "bad" }, body })).status).toBe(400);
      expect((await fetch(endpoint, { method: "POST", headers, body })).status).toBe(202);
      expect((await fetch(endpoint, { method: "POST", headers, body })).status).toBe(202);
    } finally { await listener.close(); }
    const job = await jobs.claim(org); expect(job?.resourceId).toBe(42);
    expect(await jobs.retry(org, job!, 0)).toBe(true);
    const retried = await jobs.claim(org); expect(retried?.attempts).toBe(2);
    expect(await jobs.complete(org, retried!)).toBe(true);
    expect(await jobs.claim(org)).toBeNull();
  });
  it("retries a queued event and applies the matching course grant", async () => {
    const jobs = new PurchaseSyncWebhookJobsRepository(drizzle(pool));
    const secret = "staging-test-secret-that-is-long-enough";
    const listener = await startLocalWooWebhookServer({ secret, port: 0, enqueue: (job) => jobs.enqueue(org, job) });
    const body = JSON.stringify({ id: 42 });
    const headers = { "x-wc-webhook-signature": createHmac("sha256", secret).update(body).digest("base64"), "x-wc-webhook-topic": "order.updated", "x-wc-webhook-delivery-id": "access-test" };
    try { expect((await fetch(`http://127.0.0.1:${listener.port}/woocommerce-webhook`, {method:"POST",headers,body})).status).toBe(202); }
    finally { await listener.close(); }
    const first = await jobs.claim(org); expect(first).not.toBeNull();
    expect(await jobs.retry(org, first!, 0)).toBe(true);
    const retried = await jobs.claim(org); expect(retried?.attempts).toBe(2);
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const uid=genId("user"), member=genId("orgUser"), bundle=genId("bundle");
        await tx.execute(sql`insert into users (id,email) values (${uid},${uid+'@test.invalid'})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${member},${uid})`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundle},'test')`);
        const products = new ProductCourseMappingsRepository(tx);
        await products.replace(org,{courseId:course,productIds:[10]});
        const ledger=new PurchaseSyncLedgerRepository(tx), grants=new DrizzleEntitlementsRepository(tx);
        const service=new PurchaseSyncService({run:async(fn)=>fn({ledger,grants,outbox:new DrizzleOutboxAppender(tx),productMappings:products})});
        const integrationId=courseSyncIntegrationId(course), key={orgId:org,orgUserId:member,integrationId};
        const store=createWooLmsStore({...key,courseId:course,bundleId:bundle,managesSubscription:false,expectedCourseProductIds:[10],readLedger:()=>ledger.get(key),commit:input=>service.commit(input,actorWith({id:'test',orgId:org,owner:true})),reportHeld:()=>{throw new Error('Unexpected hold');}});
        const now=Date.now();
        expect(await reconcileWooPurchases({store,customerId:42,courseProductId:10,subscriptionProductId:20,now:()=>now,maxAgeMs:60000,readSnapshot:async()=>({capturedAt:now,subscriptions:[],orders:[{id:42,customer_id:42,status:'completed',date_paid_gmt:'2025-01-01T00:00:00',refunds:[],line_items:[{product_id:10}]}]})})).toBe('committed');
        expect(await grants.hasAccess(org,member,course)).toBe(true);
        throw rollback;
      });
    } catch(error) { if(error !== rollback) {throw error;} }
    expect(await jobs.complete(org,retried!)).toBe(true);
    expect(await jobs.claim(org)).toBeNull();
  });
  it("only lists customer bindings backed by the selected WordPress identity", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const authId = genId("user"), memberUser = genId("user"), memberId = genId("orgUser");
        await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId + '@test.invalid'},true,now(),now())`);
        await tx.execute(sql`insert into users (id,email,external_id) values (${memberUser},${memberUser + '@test.invalid'},${authId})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${memberId},${memberUser})`);
        await tx.execute(sql`insert into purchase_sync_customers (org_id,org_user_id,customer_id) values (${org},${memberId},12345)`);
        const bindings = new PurchaseSyncMappingsRepository(tx);
        expect(await bindings.listVerifiedCustomers(org, 'test-provider')).toEqual([]);
        await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},'12345','other-provider',${authId},now(),now())`);
        expect(await bindings.listVerifiedCustomers(org, 'test-provider')).toEqual([]);
        await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},'12345','test-provider',${authId},now(),now())`);
        expect(await bindings.listVerifiedCustomers(org, 'test-provider')).toEqual([{customerId:12345,orgUserId:memberId}]);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) {throw error;} }
  });
  it("uses saved products for two customers with earlier purchases", async () => {
    await repo.replace(org, { courseId: course, productIds: [10, 11] });
    const mapping = await repo.get(org, course);
    expect(mapping).not.toBeNull();
    const now = Date.parse("2026-11-15T12:00:00Z");
    for (const customerId of [3, 4]) {
      const result = planWooSync({
        customerId, courseProductId: 10, courseProductIds: mapping!.productIds,
        subscriptionProductId: 20, ownership: { course: "none", subscription: "none" },
        now, maxAgeMs: 60000, previous: null,
        snapshot: { capturedAt: now, subscriptions: [], orders: [{ id: customerId, customer_id: customerId, status: "completed", date_paid_gmt: "2025-01-01T00:00:00", refunds: [], line_items: [{ product_id: customerId === 3 ? 10 : 11 }] }] },
      });
      expect(result.decisions.course).toBe("grant");
    }
  });
  it("grants two members access using the saved mapping and earlier purchases", async () => {
    const staging = process.env.FRETWISE_TEST_STAGING_ORDERS ? JSON.parse(process.env.FRETWISE_TEST_STAGING_ORDERS) : null;
    const productIds = staging ? [22049175, 22049189] : [10, 11];
    await repo.replace(org, { courseId: course, productIds });
    const mapping = await repo.get(org, course);
    const db = drizzle(pool);
    const rollback = new Error("rollback");
    try {
      await db.transaction(async (tx) => {
        const bundleId = genId("bundle");
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundleId},'test')`);
        for (const [index, productId] of productIds.entries()) {
          const userId = genId("user");
          const orgUserId = genId("orgUser");
          await tx.execute(sql`insert into users (id,email) values (${userId},${`${userId}@test.invalid`})`);
          await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${orgUserId},${userId})`);
          const ledger = new PurchaseSyncLedgerRepository(tx);
          const grants = new DrizzleEntitlementsRepository(tx);
          const service = new PurchaseSyncService({ run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx) }) });
          const integrationId = "woocommerce-test";
          const key = { orgId: org, orgUserId, integrationId };
          const store = createWooLmsStore({ ...key, courseId: course, bundleId, managesSubscription: false, readLedger: () => ledger.get(key), commit: (input) => service.commit(input, actorWith({ id: "test", orgId: org, owner: true })), reportHeld: () => { throw new Error("unexpected hold"); } });
          const now = Date.now();
          await reconcileWooPurchases({ store, customerId: staging ? 23003228 : index + 1, courseProductId: productIds[0]!, courseProductIds: mapping!.productIds, subscriptionProductId: staging ? 22049176 : 20, now: () => now, maxAgeMs: 60000, readSnapshot: async () => ({ capturedAt: now, subscriptions: [], orders: staging ? staging.filter((order: { line_items: { product_id: number }[] }) => order.line_items.some((item) => item.product_id === productId)) : [{ id: index + 1, customer_id: index + 1, status: "completed", date_paid_gmt: "2025-01-01T00:00:00", refunds: [], line_items: [{ product_id: productId }] }] }) });
          expect(await grants.hasAccess(org, orgUserId, course)).toBe(true);
        }
        throw rollback;
      });
    } catch (error) { if (error !== rollback) {throw error;} }
  });
  it("discovers verified customers and mapped courses and grants only matching purchases", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const secondCourse = genId("course"), bundleId = genId("bundle");
        await tx.execute(sql`insert into content_items (org_id,id,type) values (${org},${secondCourse},'course')`);
        await tx.execute(sql`insert into courses (org_id,id,title,slug,category) values (${org},${secondCourse},${secondCourse},${secondCourse},'')`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundleId},'test')`);
        const products = new ProductCourseMappingsRepository(tx);
        await products.replace(org, { courseId: course, productIds: [10, 11] });
        await products.replace(org, { courseId: secondCourse, productIds: [12] });
        const members: string[] = [];
        for (const [index, id] of [101, 102].entries()) {
          const authId=genId("user"), userId=genId("user"), member=genId("orgUser"); members.push(member);
          await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId+'@test.invalid'},true,now(),now())`);
          await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},${String(id)},'test-provider',${authId},now(),now())`);
          await tx.execute(sql`insert into users (id,email,external_id) values (${userId},${userId+'@test.invalid'},${authId})`);
          await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${member},${userId})`);
          await tx.execute(sql`insert into purchase_sync_customers (org_id,org_user_id,customer_id) values (${org},${member},${id})`);
          expect(index).toBeLessThan(2);
        }
        const ledger = new PurchaseSyncLedgerRepository(tx), grants = new DrizzleEntitlementsRepository(tx);
        const service = new PurchaseSyncService({ run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx), productMappings: products }) });
        const now = Date.now();
        const readPurchases = createWooPurchaseReader({ origin:"https://staging.example.test", allowedOrigins:["https://staging.example.test"], credentials:{key:"test",secret:"test"}, fetcher:async (input) => { const url=new URL(String(input)); const customerId=Number(url.searchParams.get("customer")); const orders=url.pathname.endsWith("orders") ? [{id:customerId,customer_id:customerId,status:"completed",date_paid_gmt:"2025-01-01T00:00:00",refunds:[],line_items:[{product_id:customerId===101?11:12}]}] : []; return Response.json(orders,{headers:{"x-wp-totalpages":orders.length?"1":"0"}}); } });
        const result = await reconcileMappedCourses({
          listVerifiedCustomers: () => new PurchaseSyncMappingsRepository(tx).listVerifiedCustomers(org, "test-provider"),
          listCourseMappings: () => products.list(org),
          readSnapshot: async (customerId) => ({capturedAt: now, ...(await readPurchases(customerId))}),
          storeFor: async (customer,mapping) => { const integrationId=courseSyncIntegrationId(mapping.courseId); const key={orgId:org,orgUserId:customer.orgUserId,integrationId}; return createWooLmsStore({...key,courseId:mapping.courseId,bundleId,managesSubscription:false,expectedCourseProductIds:mapping.productIds,readLedger:()=>ledger.get(key),commit:(input)=>service.commit(input,actorWith({id:"test",orgId:org,owner:true})),reportHeld:()=>{}}); },
          subscriptionProductIds:[20],now:()=>now,maxAgeMs:60000,onError:()=>{throw new Error("Unexpected sync failure");},
        });
        expect(result).toEqual({checked:4,failed:0});
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        expect(await grants.hasAccess(org,members[0]!,secondCourse)).toBe(false);
        expect(await grants.hasAccess(org,members[1]!,course)).toBe(false);
        expect(await grants.hasAccess(org,members[1]!,secondCourse)).toBe(true);
        await products.replace(org, { courseId: course, productIds: [99] });
        await expect(service.commit({ orgUserId: members[0]!, integrationId: courseSyncIntegrationId(course), courseId: course, bundleId, expectedRevision: 0, expectedCourseProductIds: [10, 11], snapshot: { capturedAt: now + 1, known: { course: [], subscription: [] } }, decisions: { course: "revoke", subscription: "hold" } }, actorWith({id:"test",orgId:org,owner:true}))).rejects.toThrow("mapping changed");
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        await products.replace(org, { courseId: course, productIds: [] });
        const integrationId = courseSyncIntegrationId(course);
        const key = { orgId: org, orgUserId: members[0]!, integrationId };
        const store = createWooLmsStore({ ...key, courseId: course, bundleId, managesSubscription: false, expectedCourseProductIds: [], readLedger: () => ledger.get(key), commit: (input) => service.commit(input, actorWith({ id: "test", orgId: org, owner: true })), reportHeld: () => { throw new Error("unexpected hold"); } });
        expect(await reconcileWooPurchases({ store, customerId: 101, courseProductIds: [], subscriptionProductId: 20, now: () => now + 1000, maxAgeMs: 60000, readSnapshot: async () => ({ capturedAt: now + 1000, subscriptions: [], orders: [{ id: 101, customer_id: 101, status: "completed", date_paid_gmt: "2025-01-01T00:00:00", refunds: [], line_items: [{ product_id: 11 }] }] }) })).toBe("committed");
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(false);
        expect(await grants.hasAccess(org,members[1]!,secondCourse)).toBe(true);
        throw rollback;
      });
    } catch(error) { if(error !== rollback) {throw error;} }
  });
  it.skipIf(process.env.FRETWISE_LIVE_STAGING_MAPPING_TEST !== "1")("uses two staging customers and real orders for independent course mappings", async () => {
    const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || testUrl.hostname !== "127.0.0.1" || testUrl.port !== "8005" || testUrl.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
    const credentials = JSON.parse(await readFile("tmp/staging-sync/credentials.json", "utf8"));
    const read = createWooPurchaseReader({ origin: "https://getfretwise-cydd.1wp.site", allowedOrigins: ["https://getfretwise-cydd.1wp.site"], credentials });
    const snapshots = await Promise.all([read(23003227), read(23003228)]);
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const secondCourse = genId("course"), bundleId = genId("bundle");
        await tx.execute(sql`insert into content_items (org_id,id,type) values (${org},${secondCourse},'course')`);
        await tx.execute(sql`insert into courses (org_id,id,title,slug,category) values (${org},${secondCourse},${secondCourse},${secondCourse},'')`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundleId},'test')`);
        const products = new ProductCourseMappingsRepository(tx);
        await products.replace(org, { courseId: course, productIds: [22049175] });
        await products.replace(org, { courseId: secondCourse, productIds: [22049189] });
        const members: string[] = [];
        for (const id of [23003227, 23003228]) {
          const authId = genId("user"), userId = genId("user"), member = genId("orgUser"); members.push(member);
          await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId+'@test.invalid'},true,now(),now())`);
          await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},${String(id)},'test-provider',${authId},now(),now())`);
          await tx.execute(sql`insert into users (id,email,external_id) values (${userId},${userId+'@test.invalid'},${authId})`);
          await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${member},${userId})`);
          await tx.execute(sql`insert into purchase_sync_customers (org_id,org_user_id,customer_id) values (${org},${member},${id})`);
        }
        const ledger = new PurchaseSyncLedgerRepository(tx), grants = new DrizzleEntitlementsRepository(tx);
        const service = new PurchaseSyncService({ run: async (fn) => fn({ ledger, grants, outbox: new DrizzleOutboxAppender(tx), productMappings: products }) });
        const now = Date.now();
        const result = await reconcileMappedCourses({
          listVerifiedCustomers: () => new PurchaseSyncMappingsRepository(tx).listVerifiedCustomers(org, "test-provider"),
          listCourseMappings: () => products.list(org),
          readSnapshot: async (customerId) => ({capturedAt: now, ...snapshots[customerId === 23003227 ? 0 : 1]!}),
          storeFor: async (customer,mapping) => { const integrationId=courseSyncIntegrationId(mapping.courseId); const key={orgId:org,orgUserId:customer.orgUserId,integrationId}; return createWooLmsStore({...key,courseId:mapping.courseId,bundleId,managesSubscription:false,expectedCourseProductIds:mapping.productIds,readLedger:()=>ledger.get(key),commit:(input)=>service.commit(input,actorWith({id:"test",orgId:org,owner:true})),reportHeld:()=>{}}); },
          subscriptionProductIds: [22049176], now: () => now, maxAgeMs: 60000, onError: () => {throw new Error("Unexpected staging sync failure");},
        });
        expect(result).toEqual({checked:4,failed:0});
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(false);
        expect(await grants.hasAccess(org,members[0]!,secondCourse)).toBe(false);
        expect(await grants.hasAccess(org,members[1]!,course)).toBe(true);
        expect(await grants.hasAccess(org,members[1]!,secondCourse)).toBe(true);
        throw rollback;
      });
    } catch(error) { if(error !== rollback) {throw error;} }
  });
  it("persists and replaces multiple IDs, scoped to the organisation", async () => {
    expect(await repo.isCourse(org, course)).toBe(true);
    await repo.replace(org, { courseId: course, productIds: [10, 11] });
    expect(await repo.get(org, course)).toEqual({ courseId: course, productIds: [10, 11] });
    expect(await repo.list(org)).toEqual([{ courseId: course, productIds: [10, 11] }]);
    expect(await repo.get('other', course)).toBeNull();
    await repo.replace(org, { courseId: course, productIds: [12] });
    expect(await repo.get(org, course)).toEqual({ courseId: course, productIds: [12] });
  });
  it("keeps purchased course access when a separately managed subscription ends", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const uid = genId("user"), member = genId("orgUser"), bundle = genId("bundle");
        await tx.execute(sql`insert into users (id,email) values (${uid},${uid + '@test.invalid'})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${member},${uid})`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundle},'test')`);
        const ledger = new PurchaseSyncLedgerRepository(tx), grants = new DrizzleEntitlementsRepository(tx);
        const products = new ProductCourseMappingsRepository(tx);
        const service = new PurchaseSyncService({ run: async (fn) => fn({ledger, grants, outbox: new DrizzleOutboxAppender(tx), productMappings: products}) });
        const actor = actorWith({id: "test", orgId: org, owner: true});
        const makeStore = (id: string, subscription: boolean) => createWooLmsStore({orgUserId: member, integrationId: id, courseId: course, bundleId: bundle, managesCourse: !subscription, managesSubscription: subscription, readLedger: () => ledger.get({orgId: org, orgUserId: member, integrationId: id}), commit: (input) => service.commit(input, actor), reportHeld: () => {throw new Error("Unexpected hold");}});
        const now = Date.now();
        const order = {id: 11, customer_id: 42, status: "completed", date_paid_gmt: "2025-01-01T00:00:00", refunds: [], line_items: [{product_id: 10}]};
        const subscription = {id: 12, customer_id: 42, status: "active", line_items: [{product_id: 20}]};
        const run = (store: ReturnType<typeof makeStore>, at: number, state: string) => reconcileWooPurchases({store, customerId: 42, courseProductId: 10, subscriptionProductId: 20, now: () => at, maxAgeMs: 60000, readSnapshot: async () => ({capturedAt: at, orders: [order], subscriptions: [{...subscription, status: state}]})});
        await run(makeStore("course-test", false), now, "active");
        await run(makeStore("subscription-test", true), now, "active");
        expect((await grants.lockIntegrationGrant(org, {orgUserId: member, bundleId: bundle}))?.grant.status).toBe("active");
        await run(makeStore("subscription-test", true), now + 1, "cancelled");
        expect((await grants.lockIntegrationGrant(org, {orgUserId: member, bundleId: bundle}))?.grant.status).toBe("revoked");
        expect(await grants.hasAccess(org, member, course)).toBe(true);
        throw rollback;
      });
    } catch (error) {if (error !== rollback) {throw error;}}
  });
  it("expands an all-access subscription to future content and preserves separate purchases", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const uid = genId("user"), member = genId("orgUser"), bundle = genId("bundle"), future = genId("course"), download = genId("download"), community = genId("community"), event = genId("event");
        await tx.execute(sql`insert into users (id,email) values (${uid},${uid + '@test.invalid'})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id) values (${org},${member},${uid})`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundle},'test')`);
        await tx.execute(sql`insert into purchase_sync_all_access_bundles (org_id,bundle_id) values (${org},${bundle})`);
        await tx.execute(sql`insert into entitlements (org_id,id,org_user_id,bundle_id,status,source) values (${org},${genId("entitlement")},${member},${bundle},'active','integration:subscription')`);
        await tx.execute(sql`insert into entitlements (org_id,id,org_user_id,content_id,status,source) values (${org},${genId("entitlement")},${member},${course},'active','integration:purchase')`);
        const grants = new DrizzleEntitlementsRepository(tx);
        expect(await grants.hasAccess(org,member,course)).toBe(true);
        await tx.execute(sql`insert into content_items (org_id,id,type) values (${org},${future},'course'),(${org},${download},'download'),(${org},${community},'community'),(${org},${event},'event')`);
        expect(await grants.hasAccess(org,member,future)).toBe(true);
        expect(await grants.hasAccess(org,member,download)).toBe(true);
        expect(await grants.hasAccess(org,member,community)).toBe(true);
        expect(await grants.hasAccess(org,member,event)).toBe(true);
        await tx.execute(sql`update entitlements set status='revoked' where org_id=${org} and org_user_id=${member} and bundle_id=${bundle}`);
        expect(await grants.hasAccess(org,member,future)).toBe(false);
        expect(await grants.hasAccess(org,member,download)).toBe(false);
        expect(await grants.hasAccess(org,member,community)).toBe(false);
        expect(await grants.hasAccess(org,member,event)).toBe(false);
        expect(await grants.hasAccess(org,member,course)).toBe(true);
        throw rollback;
      });
    } catch (error) {if (error !== rollback) {throw error;}}
  });
  it("reports verified subscription status only while its synchronized grant is current", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const authId = genId("user"), uid = genId("user"), member = genId("orgUser"), bundle = genId("bundle"), grant = genId("entitlement");
        await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId+'@test.invalid'},true,now(),now())`);
        await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},'12345','fretwise-wordpress-staging',${authId},now(),now())`);
        await tx.execute(sql`insert into users (id,email,external_id) values (${uid},${uid+'@test.invalid'},${authId})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id,status) values (${org},${member},${uid},'active')`);
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundle},'test')`);
        await tx.execute(sql`insert into purchase_sync_customers (org_id,org_user_id,customer_id) values (${org},${member},12345)`);
        await tx.execute(sql`insert into purchase_sync_mappings (org_id,org_user_id,integration_id,customer_id,course_product_id,subscription_product_ids,course_id,bundle_id,manages_subscription) values (${org},${member},'woocommerce-local-test',12345,10,'[20]'::jsonb,${course},${bundle},true)`);
        await tx.execute(sql`insert into entitlements (org_id,id,org_user_id,bundle_id,status,source) values (${org},${grant},${member},${bundle},'active','integration:woocommerce-local-test')`);
        const version = await tx.execute(sql`select xmin::text as version from entitlements where org_id=${org} and id=${grant}`);
        const state = {capturedAt: Date.now() - 1000, known: {course: [], subscription: ["1"]}, managed: {subscription: {id: grant, version: String(version.rows[0]!.version)}}};
        await tx.execute(sql`insert into purchase_sync_ledgers (org_id,org_user_id,integration_id,revision,state) values (${org},${member},'woocommerce-local-test',1,${JSON.stringify(state)}::jsonb)`);
        const report = new DrizzleAdminRepository(tx);
        const profiles = new DrizzleMemberRepository(tx);
        await new PurchaseSyncHealthRepository(tx).record(org, 'woocommerce-local-test', 'ok');
        const active = await report.getStudent(org,member);
        expect(active?.wooCustomerId).toBe(12345);
        expect(active?.wooSubscribed).toBe(true);
        expect(await profiles.profileBadge(org, member)).toBe('subscriber');
        await tx.execute(sql`update entitlements set source='manual' where org_id=${org} and id=${grant}`);
        expect((await report.getStudent(org,member))?.wooSubscribed).toBeNull();
        expect(await profiles.profileBadge(org, member)).toBeNull();
        await tx.execute(sql`delete from entitlements where org_id=${org} and id=${grant}`);
        const courseGrant = genId("entitlement");
        await tx.execute(sql`insert into entitlements (org_id,id,org_user_id,content_id,status,source) values (${org},${courseGrant},${member},${course},'active','integration:woocommerce-local-test')`);
        const courseVersion = await tx.execute(sql`select xmin::text as version from entitlements where org_id=${org} and id=${courseGrant}`);
        const courseState = { capturedAt: Date.now() - 1000, known: { course: ['2'], subscription: [] }, managed: { course: { id: courseGrant, version: String(courseVersion.rows[0]!.version) } } };
        await tx.execute(sql`update purchase_sync_ledgers set state=${JSON.stringify(courseState)}::jsonb where org_id=${org} and org_user_id=${member}`);
        expect(await profiles.profileBadge(org, member)).toBe('student');
        state.capturedAt = Date.now() - 3600000;
        await tx.execute(sql`update purchase_sync_ledgers set state=${JSON.stringify(state)}::jsonb where org_id=${org} and org_user_id=${member}`);
        expect((await report.getStudent(org,member))?.wooSubscribed).toBeNull();
        throw rollback;
      });
    } catch (error) {if (error !== rollback) {throw error;}}
  });
  it("preserves influences and visibility when each is updated separately", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const profiles = new DrizzleIdentityRepository(tx);
        await profiles.upsertProfile(user, { influences: ["John Mayer"] });
        await profiles.upsertProfile(user, { sharing: { recent: false, saved: true } });
        const profile = await profiles.findProfile(user);
        expect(profile?.extra).toMatchObject({ influences: ["John Mayer"], sharing: { recent: false, saved: true } });
        await profiles.upsertProfile(user, { influences: ["Jimi Hendrix"] });
        expect((await profiles.findProfile(user))?.extra).toMatchObject({ influences: ["Jimi Hendrix"], sharing: { recent: false, saved: true } });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) {throw error;} }
  });
  it("discovers linked WordPress identities and persists and clears failures", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const authId = genId("user"), uid = genId("user"), member = genId("orgUser");
        await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId+'@test.invalid'},true,now(),now())`);
        await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},'12345','fretwise-wordpress-staging',${authId},now(),now())`);
        await tx.execute(sql`insert into users (id,email,external_id) values (${uid},${uid+'@test.invalid'},${authId})`);
        await tx.execute(sql`insert into org_users (org_id,id,user_id,status) values (${org},${member},${uid},'active')`);
        const identities = new PurchaseSyncMappingsRepository(tx);
        expect(await identities.discoverVerifiedCustomers(org, "fretwise-wordpress-staging")).toEqual([{customerId: 12345, orgUserId: member}]);
        await identities.linkVerifiedCustomer(org, member, "fretwise-wordpress-staging", 12345);
        expect(await identities.lock(org, member, "fretwise-wordpress-staging", 12345)).toBe(true);
        expect(await identities.lock(org, member, "fretwise-wordpress-staging", 54321)).toBe(false);
        const failures = new PurchaseSyncFailuresRepository(tx);
        await failures.record(org, member, "subscription", "failed");
        await failures.record(org, member, "subscription", "failed");
        expect((await failures.list(org)).map(({orgUserId,target,attempts}) => ({orgUserId,target,attempts}))).toEqual([{orgUserId: member,target:"subscription",attempts:2}]);
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncIssues).toEqual(["subscription"]);
        await failures.record(org, member, "subscription", "succeeded");
        expect(await failures.list(org)).toEqual([]);
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncIssues).toEqual([]);
        const health = new PurchaseSyncHealthRepository(tx);
        await health.record(org, "woocommerce-local-test", "error");
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncHealth).toBe("error");
        await health.record(org, "woocommerce-local-test", "ok");
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncHealth).toBe("ok");
        await tx.execute(sql`update purchase_sync_health set checked_at=now()-interval '10 minutes' where org_id=${org}`);
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncHealth).toBe("unknown");
        await tx.execute(sql`update purchase_sync_customers set customer_id=54321 where org_id=${org} and org_user_id=${member}`);
        expect(await identities.lock(org, member, "fretwise-wordpress-staging", 12345)).toBe(false);
        await expect(identities.discoverVerifiedCustomers(org, "fretwise-wordpress-staging")).rejects.toThrow("Ambiguous");
        await failures.record(org, member, "snapshot", "failed");
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooSyncIssues).toEqual(["snapshot"]);
        expect((await new DrizzleAdminRepository(tx).getStudent(org, member))?.wooCustomerId).toBeNull();
        throw rollback;
      });
    } catch (error) {if (error !== rollback) {throw error;}}
  });
  it("automatically links and reconciles multiple verified customers with platform-wide subscriptions", async () => {
    const rollback = new Error("rollback");
    try {
      await drizzle(pool).transaction(async (tx) => {
        const bundle = genId("bundle"), future = genId("course");
        await tx.execute(sql`insert into bundles (org_id,id,name) values (${org},${bundle},'test all access')`);
        await tx.execute(sql`insert into purchase_sync_all_access_bundles (org_id,bundle_id) values (${org},${bundle})`);
        await tx.execute(sql`insert into content_items (org_id,id,type) values (${org},${future},'course')`);
        await new ProductCourseMappingsRepository(tx).replace(org, {courseId: course, productIds: [10, 11]});
        const members: string[] = [];
        for (const customerId of [101, 102, 103]) {
          const authId = genId("user"), uid = genId("user"), member = genId("orgUser"); members.push(member);
          await tx.execute(sql`insert into ba_user (id,name,email,email_verified,created_at,updated_at) values (${authId},'test',${authId+'@test.invalid'},true,now(),now())`);
          await tx.execute(sql`insert into ba_account (id,account_id,provider_id,user_id,created_at,updated_at) values (${genId("user")},${String(customerId)},'general-test',${authId},now(),now())`);
          await tx.execute(sql`insert into users (id,email,external_id) values (${uid},${uid+'@test.invalid'},${authId})`);
          await tx.execute(sql`insert into org_users (org_id,id,user_id,status) values (${org},${member},${uid},'active')`);
        }
        const stores = createWooGeneralStores(tx, {orgId: org, providerId: "general-test", subscriptionBundleId: bundle});
        const failures = new PurchaseSyncFailuresRepository(tx);
        let at = Date.now(), subscriptionStatus = "active", snapshotFailure = false;
        const options = {...stores, now: () => at, maxAgeMs: 60000,
          readSnapshot: async (customerId: number) => {
            if (customerId === 103 && snapshotFailure) {throw new Error("Test shop unavailable");}
            return {capturedAt: at, orders: customerId === 101 ? [{id: 1, customer_id: 101, status: "completed", date_paid_gmt: "2025-01-01T00:00:00", refunds: [], line_items: [{product_id: 11}]}] : [], subscriptions: customerId === 102 ? [{id: 2, customer_id: 102, status: subscriptionStatus, line_items: [{product_id: 999}]}] : []};
          },
          recordOutcome: async ({customer,target,state}: import("../../../fretwise-lms-frontend/lib/server/woocommerce-account-sync.js").WooSyncOutcome) => failures.record(org,customer.orgUserId,target.kind === "course" ? `course:${target.courseId}` : target.kind,state),
        };
        expect(await reconcileWooAccounts(options)).toEqual({customers: 3, succeeded: 6, failed: 0});
        const grants = new DrizzleEntitlementsRepository(tx);
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        expect(await grants.hasAccess(org,members[0]!,future)).toBe(false);
        expect(await grants.hasAccess(org,members[1]!,future)).toBe(true);
        expect(await grants.hasAccess(org,members[2]!,course)).toBe(false);
        expect((await new PurchaseSyncMappingsRepository(tx).listVerifiedCustomers(org,"general-test")).length).toBe(3);
        at += 1000; subscriptionStatus = "cancelled";
        expect(await reconcileWooAccounts(options)).toEqual({customers: 3, succeeded: 6, failed: 0});
        expect(await grants.hasAccess(org,members[1]!,future)).toBe(false);
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        expect(await failures.list(org)).toEqual([]);
        at += 1000; snapshotFailure = true;
        expect(await reconcileWooAccounts(options)).toEqual({customers: 3, succeeded: 4, failed: 1});
        expect((await failures.list(org)).map((failure) => [failure.orgUserId, failure.target])).toEqual([[members[2], "snapshot"]]);
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        at += 1000; snapshotFailure = false;
        expect(await reconcileWooAccounts(options)).toEqual({customers: 3, succeeded: 6, failed: 0});
        expect(await failures.list(org)).toEqual([]);
        const identityCheckedStore = await stores.courseStore({customerId: 101, orgUserId: members[0]!}, {courseId: course, productIds: [10, 11]});
        await tx.execute(sql`update ba_account set account_id='999' where provider_id='general-test' and account_id='101'`);
        at += 1000;
        await expect(reconcileWooPurchases({store: identityCheckedStore, customerId: 101, courseProductIds: [10,11], allSubscriptions: true, now: () => at, maxAgeMs: 60000, readSnapshot: async () => ({capturedAt: at,orders: [],subscriptions: []})})).rejects.toThrow("identity changed");
        expect(await grants.hasAccess(org,members[0]!,course)).toBe(true);
        throw rollback;
      });
    } catch (error) {if (error !== rollback) {throw error;}}
  });
});
