"use server";

// Server actions for the course Settings tab.

import { revalidatePath } from "next/cache";
import { Content } from "@headless-lms/sdk";

import { authHeaders } from "@/lib/api/server-call";
import type { CommentSettings, Course, CourseSettings } from "@/lib/api/types";

export async function setCourseDescriptionsAction(courseId: string, values: { short?: string; body?: string | null }): Promise<void> {
  if (values.short !== undefined) await Content.updateCourse({ id: courseId, description: values.short }, await authHeaders());
  if (values.body !== undefined) await Content.updateCourseSettings({ id: courseId, bodyDescription: values.body }, await authHeaders());
  revalidatePath("/courses/[courseId]/settings", "page");
  revalidatePath("/courses");
}

/** Set or clear (null) the course's cover. */
export async function setCourseThumbnailAction(
  courseId: string,
  thumbnailAssetId: string | null,
  background = false,
): Promise<Course | void> {
  if (background) {
    await Content.updateCourseSettings({ id: courseId, lessonBackgroundAssetId: thumbnailAssetId }, await authHeaders());
    revalidatePath("/courses/[courseId]/settings", "page");
    return;
  }
  const course = await Content.updateCourse(
    { id: courseId, thumbnailAssetId },
    await authHeaders(),
  );
  revalidatePath("/courses/[courseId]/settings", "page");
  // The cover is on the course card too.
  revalidatePath("/courses");
  return course;
}

/** Comment settings live on the course, so a write is a course settings patch
 *  carrying the whole `comments` block. */
export async function setCommentsSettingsAction(
  courseId: string,
  comments: CommentSettings,
): Promise<CourseSettings> {
  const settings = await Content.updateCourseSettings(
    { id: courseId, comments },
    await authHeaders(),
  );
  revalidatePath("/courses/[courseId]/settings", "page");
  // Turning comments off (or requiring review) changes what the moderation
  // queue holds, so the Comments tab is stale too.
  revalidatePath("/courses/[courseId]/discussion", "page");
  return settings;
}

export async function setSongLibraryAction(courseId: string, songLibrary: boolean): Promise<CourseSettings> {
  const settings = await Content.updateCourseSettings({ id: courseId, songLibrary }, await authHeaders());
  revalidatePath("/courses/[courseId]/settings", "page");
  revalidatePath("/courses");
  return settings;
}

export async function setCourseProductMappingAction(courseId: string, productIds: number[], primaryProductId: number | null): Promise<void> {
  const { Integrations } = await import("@headless-lms/sdk");
  await Integrations.replaceCourseProductMapping({ courseId, productIds, primaryProductId }, await authHeaders());
  revalidatePath("/courses/[courseId]/settings", "page");
}

export async function searchStagingProductsAction(query: string): Promise<{ id: number; name: string }[]> {
  const { requirePermission } = await import("@/lib/auth/server-permissions");
  await requirePermission("integrations:read");
  if (process.env.NODE_ENV === "production" || process.env.FRETWISE_STAGING_PRODUCT_PICKER !== "1") throw new Error("The staging product picker is not enabled.");
  if (query.length > 100) throw new Error("Search is too long.");
  const url = new URL("https://getfretwise-cydd.1wp.site/wp-json/wc/store/v1/products");
  url.searchParams.set("per_page", "100");
  if (query.trim()) url.searchParams.set("search", query.trim());
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error("Could not load staging products.");
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.some((item) => !item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== "string")) throw new Error("Unexpected product response.");
  return data.map((item) => ({ id: item.id, name: item.name }));
}

export async function lookupStagingProductsAction(ids: number[]): Promise<{ id: number; name: string }[]> {
  const { requirePermission } = await import("@/lib/auth/server-permissions");
  await requirePermission("integrations:read");
  if (process.env.NODE_ENV === "production" || process.env.FRETWISE_STAGING_PRODUCT_PICKER !== "1") throw new Error("The staging product picker is not enabled.");
  if (ids.length === 0) return [];
  if (ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) throw new Error("Invalid product IDs.");
  const url = new URL("https://getfretwise-cydd.1wp.site/wp-json/wc/store/v1/products");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("include", ids.join(","));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error("Could not load staging products.");
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.some((item) => !item || !Number.isSafeInteger(item.id) || typeof item.name !== "string")) throw new Error("Unexpected product response.");
  return data.map((item) => ({ id: item.id, name: item.name }));
}
