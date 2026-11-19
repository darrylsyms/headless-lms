import { Content } from "@headless-lms/sdk";
import { API_URL, authHeaders } from "@/lib/api/server-call";
import editorModule from "@/editor.config";
import { ForbiddenView } from "@/components/full-page-states";
import { courseSettingsOf } from "@/lib/api/compose";
import type { ActivitySettings } from "@/lib/api/types";
import { formatContentType } from "@/lib/format";

import { ActivityBuilder } from "./_components/activity-builder";
import { loadActivity, panelFromParam } from "./load-activity";

export default async function ActivityBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; activityId: string }>;
  searchParams: Promise<{ panel?: string; feed?: string }>;
}) {
  const [{ courseId, activityId }, { panel, feed }] = await Promise.all([params, searchParams]);

  const loaded = await loadActivity(courseId, activityId);
  if (!loaded) return <ForbiddenView description="You don't have access to manage this course." />;
  const { course, modules, parent, activity } = loaded;

  const stored = ((activity.settings ?? {}) as ActivitySettings).content;
  const { meta } = editorModule;
  const foreign =
    stored != null && (stored.type !== meta.type || stored.version !== meta.version)
      ? stored
      : null;
  const courseSettings = courseSettingsOf(course);
  const insider = await Content.getInsiderFeed(await authHeaders()).catch(() => null);

  return (
    <ActivityBuilder
      key={activity.id}
      isFeed={feed === "1"}
      isInsider={insider?.courseId === course.id}
      backgroundUrl={courseSettings.lessonBackgroundAssetId ? `${API_URL}/api/member/courses/${encodeURIComponent(course.id)}/lesson-background` : null}
      course={{ id: course.id, title: course.title }}
      modules={modules}
      moduleId={parent.id}
      activity={activity}
      initialConfig={stored != null && !foreign ? stored.config : null}
      foreignFormat={foreign ? formatContentType(foreign) : null}
      installedFormat={formatContentType(meta)}
      initialPanel={panelFromParam(panel)}
      courseTranscriptDownloads={courseSettings.transcriptDownloads}
      courseCommentsEnabled={courseSettings.comments?.enabled ?? false}
    />
  );
}
