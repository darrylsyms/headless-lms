import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { actorWith } from '@headless-lms/core/organizations';
import type { Container } from '../../../app/container.js';
import { registerAuth } from '../../plugins/auth.js';
import { errorHandler } from '../../plugins/error-handler.js';
import { mcpEndpoints } from '../../../app/mcp-endpoints.js';
import { resolvedCaller } from '../../test-caller.js';
import { memberProfileRoutes } from './profile.js';

const actor = actorWith({ id: 'ou_1', orgId: 'org_1' });
const session = vi.fn(); const customer = vi.fn(); const issue = vi.fn(); const consume = vi.fn(); const removeExpired = vi.fn();
const container = {
  mcp: mcpEndpoints({ authBaseURL: 'https://lms.example.com', adminAppUrl: 'https://admin.example.com' }),
  requestContext: { set: () => {} },
  auth: { verify: async () => ({ user: { id: 'auth_1' }, session: { activeOrganizationId: 'org_1' } }), stagingSignoutSessionBinding: session },
  organizations: { resolveCaller: async () => resolvedCaller({ id: 'org_1' }, { id: 'usr_1' }, { id: 'ou_1' }, actor) },
  identity: { stagingCommerceCustomer: customer },
  stagingSignoutChallenges: { issue, consume, removeExpired },
} as unknown as Container;
let app: FastifyInstance;
const previousFlag = process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT;
const previousSecret = process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET;
const browser = randomBytes(32).toString('base64url'); const challenge = randomBytes(32).toString('base64url');
const body = { action: 'issue', browserSecret: browser, direction: 'wordpress-to-lms' };
beforeAll(async () => { app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler); app.setErrorHandler(errorHandler); registerAuth(app, container); await memberProfileRoutes(app, container); await app.ready(); });
afterAll(async () => { await app.close(); if (previousFlag === undefined) delete process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT; else process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = previousFlag; if (previousSecret === undefined) delete process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET; else process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET = previousSecret; });
afterEach(() => { vi.clearAllMocks(); });

describe('staging sign-out challenge endpoint', () => {
  it('requires the expected origin, staging flag, verified session and linked account', async () => {
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = '1'; process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET = browser;
    let res = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers: { origin: 'https://wrong.example' }, payload: body });
    expect(res.statusCode).toBe(403); expect(session).not.toHaveBeenCalled();
    session.mockResolvedValueOnce({ userId: 'other', binding: browser });
    res = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers: { origin: 'http://localhost:3020' }, payload: body });
    expect(res.statusCode).toBe(403); expect(customer).not.toHaveBeenCalled();
    session.mockResolvedValueOnce({ userId: 'auth_1', binding: browser }); customer.mockResolvedValueOnce(null);
    res = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers: { origin: 'http://localhost:3020' }, payload: body });
    expect(res.statusCode).toBe(403); expect(issue).not.toHaveBeenCalled();
  });
  it('issues and consumes using the verified binding, not caller-supplied identity', async () => {
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = '1'; process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET = browser;
    session.mockResolvedValue({ userId: 'auth_1', binding: browser }); customer.mockResolvedValue(23003226); issue.mockResolvedValue(challenge); consume.mockResolvedValue(true); removeExpired.mockResolvedValue(undefined);
    const headers = { origin: 'http://localhost:3020' };
    const created = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers, payload: body });
    expect(created.statusCode).toBe(200); expect(created.json()).toEqual({ challenge, consumed: false });
    expect(issue).toHaveBeenCalledWith('23003226', 'wordpress-to-lms', browser);
    const used = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers, payload: { ...body, action: 'consume', challenge } });
    expect(used.statusCode).toBe(200); expect(used.json()).toEqual({ challenge: null, consumed: true });
    expect(consume).toHaveBeenCalledWith(challenge, '23003226', 'wordpress-to-lms', browser);
    const forged = await app.inject({ method: 'POST', url: '/api/member/profile/staging-signout-challenge', headers, payload: { ...body, subject: '23003227' } });
    expect(forged.statusCode).toBe(400);
  });
});
