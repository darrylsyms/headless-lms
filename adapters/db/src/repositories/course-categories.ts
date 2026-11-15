import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CourseCategoriesRepository } from "@headless-lms/core/content";
import { ConflictError, NotFoundError } from "@headless-lms/core/shared/errors";
import { settings } from "../schema/settings.js";
import { courses } from "../schema/content.js";

const namespace = "course-categories";
const namesOf = (value: unknown): string[] => {
  const names = (value as { names?: unknown } | null)?.names;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string")
    : [];
};

export class DrizzleCourseCategoriesRepository implements CourseCategoriesRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async list(orgId: string): Promise<string[]> {
    const [row] = await this.db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.orgId, orgId),
          eq(settings.namespace, namespace),
          eq(settings.scopeId, orgId),
        ),
      );
    return namesOf(row?.value);
  }

  async change(orgId: string, name: string, previous?: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const key = and(
        eq(settings.orgId, orgId),
        eq(settings.namespace, namespace),
        eq(settings.scopeId, orgId),
      );
      await tx
        .insert(settings)
        .values({ orgId, namespace, scopeId: orgId, value: { names: [] } })
        .onConflictDoNothing();
      const [row] = await tx.select().from(settings).where(key).for("update");
      if (!row) {
        throw new Error("Category settings are unavailable");
      }
      const names = namesOf(row.value);
      if (previous !== undefined && !names.includes(previous)) {
        throw new NotFoundError("Category", previous);
      }
      if (names.some((item) => item !== previous && item.toLowerCase() === name.toLowerCase())) {
        throw new ConflictError("A category with this name already exists");
      }
      if (previous !== undefined && previous !== name) {
        await tx
          .update(courses)
          .set({ category: name, updatedAt: new Date() })
          .where(and(eq(courses.orgId, orgId), eq(courses.category, previous)));
      }
      const next =
        previous === undefined
          ? [...names, name]
          : names.map((item) => (item === previous ? name : item));
      next.sort((a, b) => a.localeCompare(b));
      await tx
        .update(settings)
        .set({ value: { names: next }, updatedAt: new Date() })
        .where(key);
      return next;
    });
  }
  async delete(orgId: string, name: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const key = and(
        eq(settings.orgId, orgId),
        eq(settings.namespace, namespace),
        eq(settings.scopeId, orgId),
      );
      const [row] = await tx.select().from(settings).where(key).for("update");
      const names = namesOf(row?.value);
      if (!row || !names.includes(name)) {
        throw new NotFoundError("Category", name);
      }
      const next = names.filter((item) => item !== name);
      await tx
        .update(courses)
        .set({ category: "", updatedAt: new Date() })
        .where(and(eq(courses.orgId, orgId), eq(courses.category, name)));
      await tx
        .update(settings)
        .set({ value: { names: next }, updatedAt: new Date() })
        .where(key);
      return next;
    });
  }
}
