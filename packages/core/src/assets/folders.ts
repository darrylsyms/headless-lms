import type { Actor } from '../shared/actor.js';
import { prefixId } from '../shared/id.js';
import { InvalidInputError } from '../shared/errors.js';

export type MediaFolder = { id: string; parentId: string | null; name: string };
export interface MediaFoldersRepository {
  list(orgId: string): Promise<MediaFolder[]>;
  create(orgId: string, folder: MediaFolder): Promise<MediaFolder>;
  update(
    orgId: string,
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Promise<MediaFolder>;
  remove(orgId: string, id: string): Promise<void>;
  assign(orgId: string, assetIds: string[], folderId: string | null): Promise<void>;
}

export class MediaFoldersService {
  constructor(private readonly repo: MediaFoldersRepository) {}
  async list(actor: Actor): Promise<MediaFolder[]> {
    actor.permissions.require('media:read');
    return this.repo.list(actor.orgId);
  }
  async create(
    input: { name: string; parentId: string | null },
    actor: Actor,
  ): Promise<MediaFolder> {
    actor.permissions.require('media:write');
    const name = input.name.trim();
    if (!name || name.length > 100) {
      throw new InvalidInputError('Folder name must contain 1 to 100 characters');
    }
    return this.repo.create(actor.orgId, { id: prefixId('mfd'), name, parentId: input.parentId });
  }
  async update(
    id: string,
    patch: { name?: string; parentId?: string | null },
    actor: Actor,
  ): Promise<MediaFolder> {
    actor.permissions.require('media:write');
    const name = patch.name?.trim();
    if (name !== undefined && (!name || name.length > 100)) {
      throw new InvalidInputError('Folder name must contain 1 to 100 characters');
    }
    return this.repo.update(actor.orgId, id, { ...patch, ...(name === undefined ? {} : { name }) });
  }
  async remove(id: string, actor: Actor): Promise<void> {
    actor.permissions.require('media:write');
    await this.repo.remove(actor.orgId, id);
  }
  async assign(
    input: { assetIds: string[]; folderId: string | null },
    actor: Actor,
  ): Promise<void> {
    actor.permissions.require('media:write');
    const assetIds = [...new Set(input.assetIds)];
    if (!assetIds.length || assetIds.length > 200) {
      throw new InvalidInputError('Select between 1 and 200 files');
    }
    await this.repo.assign(actor.orgId, assetIds, input.folderId);
  }
}
