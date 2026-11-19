// Settings tab: every course-level setting, one section per group.
import { Content, Integrations } from "@headless-lms/sdk";
import { API_URL, authHeaders } from "@/lib/api/server-call";
import { serverApi } from "@/lib/api/server";
import { requirePermission } from "@/lib/auth/server-permissions";
import { courseSettingsOf } from "@/lib/api/compose";
import { SettingsSurface } from "@/components/forms/settings-section";

import { ProductMappingForm } from "./_components/product-mapping-form";
import { BasicsForm } from "./_components/basics-form";
import { ThumbnailField } from "./_components/thumbnail-field";
import { CommentsSettings } from "./_components/comments-settings";
import { CourseSettingsForm } from "../_components/course-settings-form";
import { TrailerForm } from "./_components/trailer-form";
import { BodyDescriptionForm } from "./_components/body-description-form";

export default async function CourseSettingsTab({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { permissions } = await requirePermission("courses:write", courseId);

  const categories = await Content.listCourseCategories(await authHeaders());
  const course = await serverApi.getCourse(courseId);
  const canManageProducts = permissions.hasAny(["integrations:read"]) && permissions.hasAny(["integrations:write"]);
  const mapping = canManageProducts ? await Integrations.getCourseProductMapping({ courseId }, await authHeaders()) : null;

  return (
    <SettingsSurface>
      <BasicsForm course={course} categories={categories} />
      <BodyDescriptionForm key={course.id} courseId={course.id} shortDescription={course.description} bodyDescription={course.settings.bodyDescription} />
      <div className="grid grid-cols-1 items-start gap-8 sm:grid-cols-2">
        <ThumbnailField
          courseId={course.id}
          assetId={course.thumbnailAssetId}
          url={course.thumbnailUrl}
        />
        <ThumbnailField background courseId={course.id} assetId={course.settings.lessonBackgroundAssetId ?? null} url={course.settings.lessonBackgroundAssetId ? `${API_URL}/api/assets/${encodeURIComponent(course.settings.lessonBackgroundAssetId)}/file` : null} />
      </div>
      <TrailerForm courseId={course.id} trailerUrl={course.settings.trailerUrl} />
      <CommentsSettings courseId={course.id} settings={courseSettingsOf(course).comments} />
      <CourseSettingsForm course={course} />
      {canManageProducts && <ProductMappingForm courseId={courseId} productIds={mapping?.productIds ?? []} primaryProductId={mapping?.primaryProductId ?? null} />}
    </SettingsSurface>
  );
}
