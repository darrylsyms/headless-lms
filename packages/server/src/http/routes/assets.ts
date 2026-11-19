// HTTP routes for the assets media library. Assets are stored under the org's
// private prefix and served through stable URLs that redirect to a signed
// storage URL.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Asset,
  AssetIdParam,
  AssetsPage,
  AssetsQuery,
  RequestUpload,
  UploadTicket,
  refusals,
} from '../schemas/index.js';
import type { Container } from '../../app/container.js';
import { resolveActor } from '../scope.js';

export async function assetsRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const assets = container.assets;
  const tags = ['Assets'];

  const Folder = z.object({ id: z.string(), parentId: z.string().nullable(), name: z.string() });
  const FolderId = z.object({ id: z.string() });
  r.route({
    method: 'GET', url: '/api/media-folders',
    schema: { operationId: 'listMediaFolders', tags, response: { 200: z.array(Folder), ...refusals(403) } },
    handler: async req => container.mediaFolders.list(await resolveActor(container, req)),
  });
  r.route({
    method: 'POST', url: '/api/media-folders',
    schema: { operationId: 'createMediaFolder', tags, body: z.object({ name: z.string().trim().min(1).max(100), parentId: z.string().nullable() }), response: { 201: Folder, ...refusals(400, 403, 404, 409) } },
    handler: async (req, reply) => reply.code(201).send(await container.mediaFolders.create(req.body, await resolveActor(container, req))),
  });
  r.route({
    method: 'PATCH', url: '/api/media-folders/:id',
    schema: { operationId: 'updateMediaFolder', tags, params: FolderId, body: z.object({ name: z.string().trim().min(1).max(100).optional(), parentId: z.string().nullable().optional() }), response: { 200: Folder, ...refusals(400, 403, 404, 409) } },
    handler: async req => container.mediaFolders.update(req.params.id, req.body, await resolveActor(container, req)),
  });
  r.route({
    method: 'DELETE', url: '/api/media-folders/:id',
    schema: { operationId: 'deleteMediaFolder', tags, params: FolderId, response: { 204: z.void(), ...refusals(403, 404) } },
    handler: async (req, reply) => { await container.mediaFolders.remove(req.params.id, await resolveActor(container, req)); return reply.code(204).send(); },
  });
  r.route({
    method: 'POST', url: '/api/media-folders/assign',
    schema: { operationId: 'assignMediaFolder', tags, body: z.object({ assetIds: z.array(z.string()).min(1).max(200), folderId: z.string().nullable() }), response: { 204: z.void(), ...refusals(400, 403, 404) } },
    handler: async (req, reply) => { await container.mediaFolders.assign(req.body, await resolveActor(container, req)); return reply.code(204).send(); },
  });

  r.route({
    method: 'POST',
    url: '/api/uploads',
    schema: {
      operationId: 'requestUpload',
      tags,
      summary: 'Register a library asset and get a presigned upload URL',
      description: `Requires one of \`media:write\`, \`courses:write\`, \`downloads:write\`, \`communities:write\`. \`media:write\` uploads to the library; the write permission of a content item uploads for that item when \`contentId\` names it, and the asset records it. The asset stays pending until you upload the file and confirm it. 404 when \`contentId\` is not a content item of the organization.`,
      body: RequestUpload,
      response: { 201: UploadTicket, ...refusals(403, 404) },
    },
    handler: async (req, reply) => {
      const actor = await resolveActor(container, req);
      const ticket = await assets.requestUpload(req.body, actor);
      return reply.code(201).send(ticket);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/assets/:id/confirm',
    schema: {
      operationId: 'confirmAsset',
      tags,
      summary: 'Confirm a library upload completed',
      description: `Requires one of \`media:read\`, \`courses:write\`, \`downloads:write\`, \`communities:write\`. \`media:read\` reaches every file; the write permission of a content item reaches the files uploaded for it. Captures the stored size and content type: a pending library upload becomes ready; a ready one is returned unchanged. A member upload is finalized only by its uploader and is answered with 403.`,
      params: AssetIdParam,
      response: { 200: Asset, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return assets.confirm(req.params.id, actor);
    },
  });

  r.route({
    method: 'GET',
    url: '/api/assets',
    schema: {
      operationId: 'listAssets',
      tags,
      summary: "Browse the organization's media library",
      description: `Requires one of \`media:read\`, \`courses:write\`, \`downloads:write\`, \`communities:write\`. \`media:read\` lists the whole library, \`source: member\` members' uploads; the write permission of a content item lists the files uploaded for it, named by \`contentId\`.`,
      querystring: AssetsQuery,
      response: { 200: AssetsPage, ...refusals(403) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return assets.list(req.query, actor);
    },
  });

  r.route({
    method: 'GET',
    url: '/api/assets/:id',
    schema: {
      operationId: 'getAsset',
      tags,
      summary: "Get an asset's metadata",
      description: `Requires one of \`media:read\`, \`courses:write\`, \`downloads:write\`, \`communities:write\`. \`media:read\` reaches every file; the write permission of a content item reaches the files uploaded for it.`,
      params: AssetIdParam,
      response: { 200: Asset, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return assets.get(req.params.id, actor);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/api/assets/:id',
    schema: {
      operationId: 'deleteAsset',
      tags,
      summary: 'Delete an asset nothing references',
      description: `Requires \`media:delete\`. Removes the row and the stored file. 409 while content still uses it.`,
      params: AssetIdParam,
      response: { 204: z.void(), ...refusals(403, 404, 409) },
    },
    handler: async (req, reply) => {
      const actor = await resolveActor(container, req);
      await assets.remove(req.params.id, actor);
      return reply.code(204).send();
    },
  });

  for (const { suffix, download, operationId, summary } of [
    {
      suffix: 'file',
      download: false,
      operationId: 'getLibraryFile',
      summary: 'Redirect to a library file to show it',
    },
    {
      suffix: 'download',
      download: true,
      operationId: 'downloadLibraryFile',
      summary: 'Redirect to a library file saved under its filename',
    },
  ]) {
    r.route({
      method: 'GET',
      url: `/api/assets/:id/${suffix}`,
      schema: {
        operationId,
        tags,
        summary,
        description: `Requires one of \`media:read\`, \`courses:write\`, \`downloads:write\`, \`communities:write\`. \`media:read\` reaches every file; the write permission of a content item reaches the files uploaded for it. Ready library files of the organization; member uploads and pending files answer 404.`,
        params: AssetIdParam,
        response: { 302: z.void(), ...refusals(403, 404) },
      },
      handler: async (req, reply) => {
        const actor = await resolveActor(container, req);
        const url = await assets.libraryFile(req.params.id, { download }, actor);
        return reply
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer')
          .redirect(url, 302);
      },
    });
  }
}
