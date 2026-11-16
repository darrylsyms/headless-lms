import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { courses } from "../schema/content.js";
import { settings } from "../schema/settings.js";

const namespace = "woocommerce-course-products";

export class ProductCourseMappingsRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async isCourse(orgId: string, courseId: string): Promise<boolean> {
    const [course] = await this.db.select({ id: courses.id }).from(courses)
      .where(and(eq(courses.orgId, orgId), eq(courses.id, courseId))).limit(1);
    return !!course;
  }

  async get(orgId: string, courseId: string): Promise<{ courseId: string; productIds: number[] } | null> {
    const [row] = await this.db.select().from(settings).where(and(
      eq(settings.orgId, orgId), eq(settings.namespace, namespace), eq(settings.scopeId, courseId),
    )).limit(1);
    if (!row) {return null;}
    const productIds = row.value.productIds;
    if (!Array.isArray(productIds) || productIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || new Set(productIds).size !== productIds.length) {throw new Error("Invalid stored product mapping.");}
    return { courseId, productIds: productIds as number[] };
  }

  async lock(orgId: string, courseId: string): Promise<{ productIds: number[] } | null> {
    const [row] = await this.db.select().from(settings).where(and(
      eq(settings.orgId, orgId), eq(settings.namespace, namespace), eq(settings.scopeId, courseId),
    )).for("update");
    if (!row) {return null;}
    const productIds = row.value.productIds;
    if (!Array.isArray(productIds) || productIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || new Set(productIds).size !== productIds.length) {throw new Error("Invalid stored product mapping.");}
    return { productIds: productIds as number[] };
  }

  async list(orgId: string): Promise<{ courseId: string; productIds: number[] }[]> {
    const rows = await this.db.select({ courseId: settings.scopeId }).from(settings)
      .innerJoin(courses, and(eq(courses.orgId, settings.orgId), eq(courses.id, settings.scopeId)))
      .where(and(eq(settings.orgId, orgId), eq(settings.namespace, namespace)));
    const mappings = await Promise.all(rows.map((row) => this.get(orgId, row.courseId)));
    return mappings.filter((mapping): mapping is { courseId: string; productIds: number[] } => mapping !== null);
  }

  async replace(orgId: string, mapping: { courseId: string; productIds: number[] }): Promise<void> {
    await this.db.insert(settings).values({ orgId, namespace, scopeId: mapping.courseId, value: { productIds: mapping.productIds } })
      .onConflictDoUpdate({ target: [settings.orgId, settings.namespace, settings.scopeId], set: { value: { productIds: mapping.productIds }, updatedAt: new Date() } });
  }
}
