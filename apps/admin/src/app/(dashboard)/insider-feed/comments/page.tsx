import { Content } from "@headless-lms/sdk";
import { authHeaders } from "@/lib/api/server-call";
import { requirePermission } from "@/lib/auth/server-permissions";
import CourseCommentsTab from "../../courses/[courseId]/discussion/page";
import type { RawSearchParams } from "../../courses/[courseId]/discussion/_lib/list-url";
import { FeedTabs } from "../tabs";
import { PageHeader } from "@/components/page-header";

export default async function FeedComments({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("courses:read");
  const feed = await Content.getInsiderFeed(await authHeaders());
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Insider Feed"
        className="min-h-9"
        actions={<span aria-hidden="true" className="block h-9" />}
      />
      <FeedTabs active="comments" canModerate />
      {feed ? (
        <CourseCommentsTab
          params={Promise.resolve({ courseId: feed.courseId })}
          searchParams={searchParams}
          pathOverride="/insider-feed/comments"
        />
      ) : (
        <p className="text-sm text-ink-4">No comments yet.</p>
      )}
    </div>
  );
}
