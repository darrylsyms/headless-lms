import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { actorWith } from '@headless-lms/core/organizations';
import type { Container } from '../../../app/container.js';
import { registerAuth } from '../../plugins/auth.js';
import { errorHandler } from '../../plugins/error-handler.js';
import { mcpEndpoints } from '../../../app/mcp-endpoints.js';
import { memberProfileRoutes } from './profile.js';
import { resolvedCaller } from '../../test-caller.js';

const org = { id: 'org_1' }; const orgUser = { id: 'ou_1' }; const actor = actorWith({ id: 'ou_1', orgId: 'org_1' });
const submit = vi.fn().mockResolvedValue(undefined);
const container = {
  mcp: mcpEndpoints({ authBaseURL: 'https://lms.example.com', adminAppUrl: 'https://admin.example.com' }),
  requestContext: { set: () => {} },
  auth: { verify: async () => ({ user: { id: 'auth_1' }, session: { activeOrganizationId: org.id } }) },
  organizations: { resolveCaller: async () => resolvedCaller(org, { id: 'usr_1' }, orgUser, actor) },
  support: { submit },
} as unknown as Container;
let app: FastifyInstance;
beforeAll(async () => { app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler); app.setErrorHandler(errorHandler); registerAuth(app, container); await memberProfileRoutes(app, container); await app.ready(); });
afterAll(async () => { await app.close(); });
describe('member support route', () => {
  it('uses the authenticated member identity', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/member/support', payload: { message: 'Help' } });
    expect(result.statusCode).toBe(204);
    expect(submit).toHaveBeenCalledWith('Help', expect.objectContaining({ userId: 'usr_1', orgId: 'org_1' }));
  });
  it('rejects a forged account or recipient', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/member/support', payload: { message: 'Help', email: 'attacker@example.com' } });
    expect(result.statusCode).toBe(400);
  });
});
