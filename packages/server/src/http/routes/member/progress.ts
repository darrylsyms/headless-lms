import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CourseProgress,
  AllSavedActivities,
  SavedActivityParam,
  RecentActivityViews,
  RecordActivityView,
  MemberCourseIdParam,
  ProgressStatus,
  ReportProgress,
  SavedActivities,
  SetSavedActivity,
  refusals,
} from '../../schemas/index.js';
import type { Container } from '../../../app/container.js';
import { resolveActor } from '../../scope.js';

export async function memberProgressRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const member = container.reporting.member;

  r.route({
    method: 'GET', url: '/api/member/saved-activities', preHandler: app.requireOrgSession,
    schema: { operationId: 'listAllSavedActivities', tags: ['Progress'], summary: 'List your saved activities', response: { 200: AllSavedActivities, ...refusals(403) } },
    handler: async (req) => container.progress.listAllSaved(await resolveActor(container, req)),
  });
  r.route({
    method: 'DELETE', url: '/api/member/saved-activities/:activityId', preHandler: app.requireOrgSession,
    schema: { operationId: 'removeSavedActivity', tags: ['Progress'], summary: 'Remove an activity from your list', params: SavedActivityParam, response: { 204: z.void(), ...refusals(403) } },
    handler: async (req, reply) => {
      await container.progress.removeSaved(req.params.activityId, await resolveActor(container, req));
      return reply.code(204).send();
    },
  });
  r.route({
    method: 'GET',
    url: '/api/member/recent-activities',
    preHandler: app.requireOrgSession,
    schema: { operationId: 'listRecentActivities', tags: ['Progress'], summary: 'List recently viewed activities', response: { 200: RecentActivityViews, ...refusals(403) } },
    handler: async (req) => container.progress.listRecentViews(await resolveActor(container, req)),
  });
  r.route({
    method: 'POST',
    url: '/api/member/recent-activities',
    preHandler: app.requireOrgSession,
    schema: { operationId: 'recordActivityView', tags: ['Progress'], summary: 'Record an activity view', body: RecordActivityView, response: { 204: z.void(), ...refusals(403, 404) } },
    handler: async (req, reply) => {
      await container.progress.recordView(req.body.activity, await resolveActor(container, req));
      return reply.code(204).send();
    },
  });
  r.route({
    method: 'POST',
    url: '/api/member/progress',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'reportProgress',
      tags: ['Progress'],
      summary: 'Report usage on an activity; the progress service decides completion',
      description:
        'For a member who can open the course, through a grant or `courses:read` on it. Reports facts, never a decision: the service decides whether the activity is complete. 404 when the activity is not published, or you cannot open its course.',
      body: ReportProgress,
      response: { 200: ProgressStatus, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      const record = await container.progress.report(
        { activityId: req.body.activity, reports: req.body.reports },
        actor,
      );
      return { status: record.completedAt ? ('completed' as const) : ('in-progress' as const) };
    },
  });

  r.route({
    method: 'GET',
    url: '/api/member/courses/:courseId/progress',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'getMemberCourseProgress',
      tags: ['Progress'],
      summary: 'Your progress in one course',
      description:
        "For a member of the organization, derived from the course's current structure. 404 when the course is not published or you do not hold it.",
      params: MemberCourseIdParam,
      response: { 200: CourseProgress, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return member.courseProgress(req.params.courseId, actor);
    },
  });
  r.route({
    method: 'GET',
    url: '/api/member/courses/:courseId/saved-activities',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'listSavedActivities',
      tags: ['Progress'],
      summary: 'List your saved lessons in a course',
      description: 'Returns published activities only when the member can open the course.',
      params: MemberCourseIdParam,
      response: { 200: SavedActivities, ...refusals(403, 404) },
    },
    handler: async (req) => ({
      saved: await container.progress.listSaved(
        req.params.courseId,
        await resolveActor(container, req),
      ),
    }),
  });
  r.route({
    method: 'PUT',
    url: '/api/member/courses/:courseId/saved-activities',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'setSavedActivity',
      tags: ['Progress'],
      summary: 'Save or remove a lesson from your list',
      description: 'Requires access to the course and a published activity in that course.',
      params: MemberCourseIdParam,
      body: SetSavedActivity,
      response: { 204: z.void(), ...refusals(403, 404) },
    },
    handler: async (req, reply) => {
      await container.progress.setSaved(
        req.params.courseId,
        req.body.activity,
        req.body.saved,
        await resolveActor(container, req),
      );
      return reply.code(204).send();
    },
  });
}
