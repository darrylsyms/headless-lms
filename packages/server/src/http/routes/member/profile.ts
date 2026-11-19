import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Container } from '../../../app/container.js';
import { resolveCaller } from '../../scope.js';
import { UpdateProfile, UserProfile, refusals } from '../../schemas/index.js';

export async function memberProfileRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['Profile'];

  async function memberOf(req: FastifyRequest) {
    const caller = await resolveCaller(container, req);
    return { ...caller.actor, userId: caller.userId };
  }

  r.route({
    method: 'POST', url: '/api/member/support', preHandler: app.requireOrgSession,
    schema: {
      operationId: 'sendMemberSupportRequest', tags: ['Support'],
      body: z.object({ message: z.string().trim().min(1).max(5000) }).strict(),
      response: { 204: z.null(), ...refusals(400, 403, 502, 503) },
    },
    handler: async (req, reply) => {
      await container.support.submit(req.body.message, await memberOf(req));
      return reply.code(204).send(null);
    },
  });

  r.route({
    method: 'POST', url: '/api/member/profile/staging-signout-nonce', preHandler: app.requireOrgSession,
    schema: { operationId: 'consumeMemberStagingSignoutNonce', tags, body: z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.number().int().positive() }).strict(), response: { 200: z.object({ consumed: z.boolean() }), ...refusals(400, 403) } },
    handler: async req => ({ consumed: await container.identity.consumeStagingSignoutNonce(req.body.nonce, req.body.expiresAt, await memberOf(req)) }),
  });

  r.route({
    method: 'POST', url: '/api/member/profile/staging-signout-challenge', preHandler: app.requireOrgSession,
    schema: {
      operationId: 'handleMemberStagingSignoutChallenge', tags,
      body: z.discriminatedUnion('action', [
        z.object({ action: z.literal('issue'), browserSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/), direction: z.enum(['wordpress-to-lms', 'lms-to-wordpress']) }).strict(),
        z.object({ action: z.literal('consume'), browserSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/), direction: z.enum(['wordpress-to-lms', 'lms-to-wordpress']), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
      ]),
      response: { 200: z.object({ challenge: z.string().nullable(), consumed: z.boolean() }), ...refusals(400, 403, 503) },
    },
    handler: async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (process.env.NODE_ENV === 'production' || process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT !== '1' || req.headers.origin !== 'http://localhost:3020') return reply.code(403).send({ error: 'forbidden', message: 'Unavailable.' });
      const session = await container.auth.stagingSignoutSessionBinding(req.headers, req.body.browserSecret, process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT_SECRET ?? '');
      if (!session || session.userId !== req.authUserId) return reply.code(403).send({ error: 'forbidden', message: 'Session unavailable.' });
      const subject = await container.identity.stagingCommerceCustomer(await memberOf(req));
      if (!subject) return reply.code(403).send({ error: 'forbidden', message: 'Account unavailable.' });
      if (req.body.action === 'issue') {
        await container.stagingSignoutChallenges.removeExpired();
        const challenge = await container.stagingSignoutChallenges.issue(String(subject), req.body.direction, session.binding);
        return { challenge, consumed: false };
      }
      const consumed = await container.stagingSignoutChallenges.consume(req.body.challenge, String(subject), req.body.direction, session.binding);
      return { challenge: null, consumed };
    },
  });

  r.route({
    method: 'GET', url: '/api/member/profile/staging-commerce-customer', preHandler: app.requireOrgSession,
    schema: { operationId: 'getMemberStagingCommerceCustomer', tags, response: { 200: z.object({ customerId: z.number().int().positive().nullable() }), ...refusals(403) } },
    handler: async req => ({ customerId: await container.identity.stagingCommerceCustomer(await memberOf(req)) }),
  });

  r.route({
    method: 'GET', url: '/api/member/profile/badge', preHandler: app.requireOrgSession,
    schema: { operationId: 'getMemberProfileBadge', tags, response: { 200: z.object({ badge: z.enum(['subscriber', 'student']).nullable() }), ...refusals(403) } },
    handler: async req => ({ badge: await container.reporting.member.profileBadge(await memberOf(req)) }),
  });

  r.route({
    method: 'GET',
    url: '/api/member/profile',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'getMemberProfile',
      tags,
      summary: 'Read your profile',
      description:
        'For any active member of the organization. The profile is yours across organizations; `imageUrl` is set only when the photo was uploaded in this organization. Before you save one, every field is empty.',
      response: { 200: UserProfile, ...refusals(403) },
    },
    handler: async (req) => {
      return container.identity.profileOf(await memberOf(req));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/api/member/profile',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'updateMemberProfile',
      tags,
      summary: 'Update your profile',
      description:
        'For a member of the organization. Changes only the fields sent; null clears one. 404 when `imageAssetId` is not a finalized image you uploaded here.',
      body: UpdateProfile,
      response: { 200: UserProfile, ...refusals(403, 404, 409) },
    },
    handler: async (req) => {
      return container.identity.updateProfile(req.body, await memberOf(req));
    },
  });
}
