import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../shared/actor.js';
import { MediaFoldersService, type MediaFoldersRepository } from './folders.js';

function setup(allowed: string[]) {
  const repo: MediaFoldersRepository = {
    list: vi.fn(async () => []),
    create: vi.fn(async (_org, folder) => folder),
    update: vi.fn(async (_org, id, patch) => ({
      id,
      name: patch.name ?? '',
      parentId: patch.parentId ?? null,
    })),
    remove: vi.fn(async () => {}),
    assign: vi.fn(async () => {}),
  };
  const actor = {
    orgId: 'org-1',
    permissions: {
      require(permission: string) {
        if (!allowed.includes(permission)) {throw new Error('Forbidden');}
      },
    },
  } as unknown as Actor;
  return { repo, actor, service: new MediaFoldersService(repo) };
}

describe('media folder authorization', () => {
  it('requires media read for listing and media write for every mutation', async () => {
    const { service, actor, repo } = setup([]);
    await expect(service.list(actor)).rejects.toThrow('Forbidden');
    await expect(service.create({ name: 'Test', parentId: null }, actor)).rejects.toThrow(
      'Forbidden',
    );
    await expect(service.update('a', { name: 'Test' }, actor)).rejects.toThrow('Forbidden');
    await expect(service.remove('a', actor)).rejects.toThrow('Forbidden');
    await expect(service.assign({ assetIds: ['a'], folderId: null }, actor)).rejects.toThrow(
      'Forbidden',
    );
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.assign).not.toHaveBeenCalled();
  });
  it('passes only the actor organization, validates names and deduplicates a batch', async () => {
    const { service, actor, repo } = setup(['media:read', 'media:write']);
    const folder = await service.create({ name: '  Guitar  ', parentId: null }, actor);
    expect(folder.name).toBe('Guitar');
    expect(repo.create).toHaveBeenCalledWith('org-1', expect.objectContaining({ name: 'Guitar' }));
    await expect(service.create({ name: ' ', parentId: null }, actor)).rejects.toThrow();
    await expect(service.assign({ assetIds: [], folderId: null }, actor)).rejects.toThrow();
    await service.assign({ assetIds: ['x', 'x', 'y'], folderId: folder.id }, actor);
    expect(repo.assign).toHaveBeenCalledWith('org-1', ['x', 'y'], folder.id);
  });
});
