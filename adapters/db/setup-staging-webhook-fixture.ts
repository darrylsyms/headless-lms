import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { genId } from "@headless-lms/core/shared/id";
import { ProductCourseMappingsRepository } from "./src/repositories/product-course-mappings.js";
const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
const orgId = "org_3LudhlwZcnDDRGwc8R0NGHc2jdu";
const file = "tmp/staging-sync/webhook-fixture.json";
try { const existing = JSON.parse(await readFile(file,"utf8")); if (typeof existing.courseId === "string") { process.stdout.write(`Existing local test course: ${existing.courseId}\n`); process.exit(0); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;} }
const pool = new pg.Pool({ connectionString:url.toString() }); const db=drizzle(pool); const courseId=genId("course");
try {
  await db.transaction(async(tx)=>{
    await tx.execute(sql`insert into content_items (org_id,id,type) values (${orgId},${courseId},'course')`);
    await tx.execute(sql`insert into courses (org_id,id,title,slug,category) values (${orgId},${courseId},'Fretwise Webhook Test (local only)',${courseId},'')`);
    await new ProductCourseMappingsRepository(tx).replace(orgId,{courseId,productIds:[22049175,22049189]});
  });
  await writeFile(file,JSON.stringify({courseId}),{mode:0o600,flag:"wx"});
  process.stdout.write(`Local test course: ${courseId}\n`);
} finally {await pool.end();}
