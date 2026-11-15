import { Content } from "@headless-lms/sdk";
import { authHeaders } from "@/lib/api/server-call";
import { requirePermission } from "@/lib/auth/server-permissions";
import { FeedTable } from "./table";

export default async function InsiderFeedPage() {
  const { permissions } = await requirePermission("courses:read");
  const headers = await authHeaders();
  const [feed, categories] = await Promise.all([
    Content.getInsiderFeed(headers),
    Content.listInsiderCategories(headers),
  ]);
  const activities = feed
    ? (await Content.listActivities({ courseId: feed.courseId }, headers)).filter(
        (activity) => activity.moduleId === feed.moduleId,
      )
    : [];
  return (
    <FeedTable
      categories={categories}
      feed={feed}
      activities={activities}
      canEdit={permissions.has("courses:write", feed?.courseId)}
      canModerate={permissions.has("courses:moderate", feed?.courseId)}
    />
  );
}
