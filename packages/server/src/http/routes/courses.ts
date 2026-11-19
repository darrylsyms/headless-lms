// HTTP routes for the courses context. Request + response are validated against
// the shared contract schemas by the Zod type provider, and @fastify/swagger
// reads the same schemas to build the OpenAPI spec the SDK is generated from.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  Course,
  CourseIdParam,
  CourseSettings,
  CoursesPage,
  CoursesQuery,
  CreateCourse,
  PatchCourseSettings,
  UpdateCourse,
  refusals,
} from '../schemas/index.js';
import { z } from 'zod';
import type { Container } from '../../app/container.js';
import { resolveActor } from '../scope.js';

export async function coursesRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const courses = container.content;

  const productMapping = z.object({ courseId: z.string(), productIds: z.array(z.number().int().positive().max(2147483647)).max(100), primaryProductId: z.number().int().positive().nullable().optional() });
  r.route({
    method: 'GET', url: '/api/courses/:courseId/product-mapping', preHandler: app.requireOrgSession,
    schema: { operationId: 'getCourseProductMapping', tags: ['Integrations'], params: z.object({ courseId: z.string() }), response: { 200: productMapping.nullable(), ...refusals(403, 404) } },
    handler: async (req) => container.productCourseMappings.get(req.params.courseId, await resolveActor(container, req)),
  });
  r.route({
    method: 'PUT', url: '/api/courses/:courseId/product-mapping', preHandler: app.requireOrgSession,
    schema: { operationId: 'replaceCourseProductMapping', tags: ['Integrations'], params: z.object({ courseId: z.string() }), body: z.object({ productIds: z.array(z.number().int().positive().max(2147483647)).max(100), primaryProductId: z.number().int().positive().nullable().optional() }), response: { 204: z.null(), ...refusals(400, 403, 404) } },
    handler: async (req, reply) => { await container.productCourseMappings.replace({ courseId: req.params.courseId, productIds: req.body.productIds, primaryProductId: req.body.primaryProductId }, await resolveActor(container, req)); return reply.code(204).send(null); },
  });

  const feed = z.object({ courseId: z.string(), moduleId: z.string() });
  r.route({
    method: 'GET', url: '/api/insider-feed', preHandler: app.requireOrgSession,
    schema: { operationId: 'getInsiderFeed', tags: ['Content'], response: { 200: feed.nullable(), ...refusals(403) } },
    handler: async (req) => courses.getInsiderFeed(await resolveActor(container, req)),
  });
  r.route({
    method: 'POST', url: '/api/insider-feed', preHandler: app.requireOrgSession,
    schema: { operationId: 'ensureInsiderFeed', tags: ['Content'], response: { 200: feed, ...refusals(403) } },
    handler: async (req) => courses.ensureInsiderFeed(await resolveActor(container, req)),
  });

  r.route({
    method: 'GET', url: '/api/insider-categories', preHandler: app.requireOrgSession,
    schema: { operationId: 'listInsiderCategories', tags: ['Content'], response: { 200: z.array(z.string()), ...refusals(403) } },
    handler: async (req) => container.insiderCategories.list(await resolveActor(container, req)),
  });
  r.route({
    method: 'POST', url: '/api/insider-categories', preHandler: app.requireOrgSession,
    schema: { operationId: 'changeInsiderCategory', tags: ['Content'], body: z.object({ name: z.string().trim().min(1).max(100), previous: z.string().optional() }), response: { 200: z.array(z.string()), ...refusals(403, 404, 409, 422) } },
    handler: async (req) => container.insiderCategories.change(req.body.name, req.body.previous, await resolveActor(container, req)),
  });
  r.route({
    method: 'DELETE', url: '/api/insider-categories', preHandler: app.requireOrgSession,
    schema: { operationId: 'deleteInsiderCategory', tags: ['Content'], body: z.object({ name: z.string().min(1).max(100) }), response: { 200: z.array(z.string()), ...refusals(403, 404) } },
    handler: async (req) => container.insiderCategories.delete(req.body.name, await resolveActor(container, req)),
  });

  r.route({
    method: 'GET',
    url: '/api/course-categories',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'listCourseCategories',
      tags: ['Content'],
      response: { 200: z.array(z.string()), ...refusals(403) },
    },
    handler: async (req) => container.courseCategories.list(await resolveActor(container, req)),
  });
  r.route({
    method: 'POST',
    url: '/api/course-categories',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'changeCourseCategory',
      tags: ['Content'],
      body: z.object({ name: z.string().trim().min(1).max(100), previous: z.string().optional() }),
      response: { 200: z.array(z.string()), ...refusals(403, 404, 409, 422) },
    },
    handler: async (req) =>
      container.courseCategories.change(
        req.body.name,
        req.body.previous,
        await resolveActor(container, req),
      ),
  });

  r.route({
    method: 'DELETE',
    url: '/api/course-categories',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'deleteCourseCategory',
      tags: ['Content'],
      body: z.object({ name: z.string().min(1).max(100) }),
      response: { 200: z.array(z.string()), ...refusals(403, 404) },
    },
    handler: async (req) =>
      container.courseCategories.delete(req.body.name, await resolveActor(container, req)),
  });

  r.route({
    method: 'GET',
    url: '/api/courses',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'listCourses',
      tags: ['Content'],
      summary: 'List courses',
      description: `Requires \`courses:read\`. Every course in the organization, drafts included, filtered by status and category and searched by title.`,
      querystring: CoursesQuery,
      response: { 200: CoursesPage, ...refusals(403) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return courses.listCourses(req.query, actor);
    },
  });

  r.route({
    method: 'GET',
    url: '/api/courses/:id',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'getCourse',
      tags: ['Content'],
      summary: 'Get a course',
      description: 'Requires `courses:read`.',
      params: CourseIdParam,
      response: { 200: Course, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return courses.getCourse(req.params.id, actor);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/courses',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'createCourse',
      tags: ['Content'],
      summary: 'Create a course',
      description: `Requires \`courses:write\`. The course starts as a draft. 409 when its slug is taken.`,
      body: CreateCourse,
      response: { 201: Course, ...refusals(403, 409) },
    },
    handler: async (req, reply) => {
      const actor = await resolveActor(container, req);
      const course = await courses.createCourse(req.body, actor);
      return reply.code(201).send(course);
    },
  });

  r.route({
    method: 'PATCH',
    url: '/api/courses/:id',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'updateCourse',
      tags: ['Content'],
      summary: 'Update a course',
      description: `Requires \`courses:write\`. Changes only the fields sent. \`thumbnailAssetId\` must be a ready library image (409 otherwise); null clears it. A file it does not already use must be uploaded for it, or the caller needs \`media:read\` (403 otherwise).`,
      params: CourseIdParam,
      body: UpdateCourse,
      response: { 200: Course, ...refusals(403, 404, 409) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return courses.updateCourse(req.params.id, req.body, actor);
    },
  });

  r.route({
    method: 'PATCH',
    url: '/api/courses/:id/settings',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'updateCourseSettings',
      tags: ['Content'],
      summary: "Update a course's settings",
      description: `Requires \`courses:write\`. Merges the settings sent into the current ones.`,
      params: CourseIdParam,
      body: PatchCourseSettings,
      response: { 200: CourseSettings, ...refusals(403, 404) },
    },
    handler: async (req) => {
      const actor = await resolveActor(container, req);
      return courses.patchCourseSettings(req.params.id, req.body, actor);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/api/courses/:id',
    preHandler: app.requireOrgSession,
    schema: {
      operationId: 'deleteCourse',
      tags: ['Content'],
      summary: 'Delete a course',
      description: 'Requires `courses:delete`.',
      params: CourseIdParam,
      response: { 204: z.void(), ...refusals(403, 404) },
    },
    handler: async (req, reply) => {
      const actor = await resolveActor(container, req);
      await courses.deleteCourse(req.params.id, actor);
      return reply.code(204).send();
    },
  });
}
