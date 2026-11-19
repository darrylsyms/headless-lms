import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MediaFolder, MediaFoldersRepository } from "@headless-lms/core/assets";
import { ConflictError, NotFoundError } from "@headless-lms/core/shared/errors";
import { assets, mediaFolderAssets, mediaFolders } from "../schema/assets.js";

export class DrizzleMediaFoldersRepository implements MediaFoldersRepository {
  constructor(private readonly db: NodePgDatabase) {}
  async list(orgId: string): Promise<MediaFolder[]> {
    return this.db
      .select({ id: mediaFolders.id, parentId: mediaFolders.parentId, name: mediaFolders.name })
      .from(mediaFolders)
      .where(eq(mediaFolders.orgId, orgId))
      .orderBy(mediaFolders.name);
  }
  async create(orgId: string, folder: MediaFolder): Promise<MediaFolder> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 24814))`);
      if (folder.parentId) {
        const [parent] = await tx
          .select({ id: mediaFolders.id })
          .from(mediaFolders)
          .where(and(eq(mediaFolders.orgId, orgId), eq(mediaFolders.id, folder.parentId)));
        if (!parent) {
          throw new NotFoundError("Folder", folder.parentId);
        }
      }
      const [duplicate] = await tx
        .select({ id: mediaFolders.id })
        .from(mediaFolders)
        .where(
          and(
            eq(mediaFolders.orgId, orgId),
            folder.parentId
              ? eq(mediaFolders.parentId, folder.parentId)
              : isNull(mediaFolders.parentId),
            sql`lower(${mediaFolders.name}) = lower(${folder.name})`,
          ),
        );
      if (duplicate) {
        throw new ConflictError("A folder with this name already exists here");
      }
      await tx.insert(mediaFolders).values({ orgId, ...folder });
      return folder;
    });
  }
  async update(
    orgId: string,
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Promise<MediaFolder> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 24814))`);
      const folders = await tx
        .select({ id: mediaFolders.id, parentId: mediaFolders.parentId, name: mediaFolders.name })
        .from(mediaFolders)
        .where(eq(mediaFolders.orgId, orgId));
      const current = folders.find((f) => f.id === id);
      if (!current) {
        throw new NotFoundError("Folder", id);
      }
      const next = { ...current, ...patch };
      let parent = next.parentId;
      const visited = new Set<string>();
      while (parent) {
        if (visited.has(parent)) {
          throw new ConflictError("Folder hierarchy is invalid");
        }
        visited.add(parent);
        if (parent === id) {
          throw new ConflictError("A folder cannot be moved inside itself");
        }
        const ancestor = folders.find((f) => f.id === parent);
        if (!ancestor) {
          throw new NotFoundError("Folder", parent);
        }
        parent = ancestor.parentId;
      }
      if (
        folders.some(
          (f) =>
            f.id !== id &&
            f.parentId === next.parentId &&
            f.name.toLowerCase() === next.name.toLowerCase(),
        )
      ) {
        throw new ConflictError("A folder with this name already exists here");
      }
      await tx
        .update(mediaFolders)
        .set({ name: next.name, parentId: next.parentId, updatedAt: new Date() })
        .where(and(eq(mediaFolders.orgId, orgId), eq(mediaFolders.id, id)));
      return next;
    });
  }
  async remove(orgId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 24814))`);
      const deleted = await tx
        .delete(mediaFolders)
        .where(and(eq(mediaFolders.orgId, orgId), eq(mediaFolders.id, id)))
        .returning({ id: mediaFolders.id });
      if (!deleted.length) {
        throw new NotFoundError("Folder", id);
      }
    });
  }
  async assign(orgId: string, assetIds: string[], folderId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 24814))`);
      if (folderId) {
        const [folder] = await tx
          .select({ id: mediaFolders.id })
          .from(mediaFolders)
          .where(and(eq(mediaFolders.orgId, orgId), eq(mediaFolders.id, folderId)));
        if (!folder) {
          throw new NotFoundError("Folder", folderId);
        }
      }
      const files = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(eq(assets.orgId, orgId), eq(assets.source, "library"), inArray(assets.id, assetIds)),
        );
      if (files.length !== assetIds.length) {
        throw new NotFoundError("Library file", "selection");
      }
      await tx
        .delete(mediaFolderAssets)
        .where(
          and(eq(mediaFolderAssets.orgId, orgId), inArray(mediaFolderAssets.assetId, assetIds)),
        );
      if (folderId) {
        await tx
          .insert(mediaFolderAssets)
          .values(assetIds.map((assetId) => ({ orgId, assetId, folderId })));
      }
    });
  }
}
