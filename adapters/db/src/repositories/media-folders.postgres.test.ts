import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { DrizzleMediaFoldersRepository } from "./media-folders.js";
import { DrizzleAssetsRepository } from "./assets.js";

const source = process.env.MEDIA_TEST_DATABASE_URL;
const suite = source ? describe : describe.skip;
suite("media folder PostgreSQL integration", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let repo: DrizzleMediaFoldersRepository;
  const dbName = `fretwise_media_test_${randomBytes(6).toString("hex")}`;
  beforeAll(async () => {
    const uri = new URL(source!);
    if (!["localhost", "127.0.0.1", "::1"].includes(uri.hostname))
      {throw new Error("Media tests require a local PostgreSQL server");}
    admin = new pg.Pool({ connectionString: source });
    await admin.query(`CREATE DATABASE "${dbName}"`);
    uri.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: uri.href });
    await pool.query(
      `CREATE TABLE organizations (id text PRIMARY KEY); CREATE TABLE assets (org_id text NOT NULL, id text NOT NULL, key text NOT NULL, kind text NOT NULL, source text NOT NULL, filename text NOT NULL, content_type text NOT NULL, size bigint NOT NULL DEFAULT 0, status text NOT NULL, uploaded_by text NOT NULL, content_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (org_id,id));`,
    );
    const migration = await readFile("adapters/db/drizzle/0040_media_folders.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint"))
      {if (statement.trim()) {await pool.query(statement);}}
    await pool.query(
      `INSERT INTO organizations(id) VALUES ('org-a'),('org-b'); INSERT INTO assets(org_id,id,key,kind,source,filename,content_type,status,uploaded_by) VALUES ('org-a','one','original-key','document','library','one.txt','text/plain','ready','a'),('org-a','two','second-key','document','library','two.txt','text/plain','ready','a'),('org-a','private','member-key','image','member','private.png','image/png','ready','a'),('org-b','other','other-key','document','library','other.txt','text/plain','ready','b')`,
    );
    repo = new DrizzleMediaFoldersRepository(drizzle(pool));
  }, 20000);
  afterAll(async () => {
    if (pool) {await pool.end();}
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await admin.end();
    }
  });
  it("protects the folder tree, organization boundaries and file access while supporting moves and deletion", async () => {
    await repo.create("org-a", { id: "a", name: "A", parentId: null });
    await repo.create("org-a", { id: "b", name: "B", parentId: "a" });
    await repo.create("org-b", { id: "c", name: "C", parentId: null });
    await expect(repo.update("org-a", "a", { parentId: "b" })).rejects.toThrow();
    await expect(repo.create("org-a", { id: "d", name: "Other", parentId: "c" })).rejects.toThrow();
    await expect(repo.assign("org-a", ["private"], "a")).rejects.toThrow();
    await expect(repo.assign("org-a", ["one", "other"], "a")).rejects.toThrow();
    await repo.assign("org-a", ["one"], "b");
    const assetsRepo = new DrizzleAssetsRepository(drizzle(pool));
    expect(
      (
        await assetsRepo.list("org-a", { page: 1, pageSize: 10, source: "library", folderId: "b" })
      ).rows.map((a) => a.id),
    ).toEqual(["one"]);
    expect(
      (
        await assetsRepo.list("org-a", {
          page: 1,
          pageSize: 10,
          source: "library",
          folderId: "unfiled",
        })
      ).rows.map((a) => a.id),
    ).toEqual(["two"]);
    await repo.remove("org-a", "a");
    expect(await repo.list("org-a")).toEqual([]);
    expect(
      (await pool.query("SELECT key FROM assets WHERE org_id='org-a' AND id='one'")).rows[0].key,
    ).toBe("original-key");
    expect(
      (
        await assetsRepo.list("org-a", {
          page: 1,
          pageSize: 10,
          source: "library",
          folderId: "unfiled",
        })
      ).total,
    ).toBe(2);
    expect((await repo.list("org-b")).map((f) => f.id)).toEqual(["c"]);
  });
});
