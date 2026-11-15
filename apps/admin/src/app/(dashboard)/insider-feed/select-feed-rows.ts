import type { Activity, ActivitySettings, ListParams } from "@/lib/api/types";

export type FeedRow = {
  activity: Activity;
  title: string;
  category: string;
  status: "published" | "scheduled" | "draft";
  updatedAt: string;
};

export function selectFeedRows(activities: Activity[], params: ListParams) {
  const search = (params.search ?? "").trim().toLocaleLowerCase();
  const statuses = params.filters?.status ?? [];
  const selectedCategories = params.filters?.category ?? [];
  const matching: FeedRow[] = activities
    .map<FeedRow>((activity) => {
      const settings = (activity.settings ?? {}) as ActivitySettings;
      return {
        activity,
        title: settings.title?.trim() || "Untitled activity",
        category: settings.category || "Uncategorised",
        status:
          settings.published !== false ? "published" : activity.scheduledAt ? "scheduled" : "draft",
        updatedAt: activity.updatedAt,
      };
    })
    .filter(
      (row) =>
        (!search ||
          row.title.toLocaleLowerCase().includes(search) ||
          row.category.toLocaleLowerCase().includes(search)) &&
        (!statuses.length || statuses.includes(row.status)) &&
        (!selectedCategories.length || selectedCategories.includes(row.category)),
    );
  const sort = params.sort ?? [];
  matching.sort((a, b) => {
    for (const { id, desc } of sort) {
      if (id !== "title" && id !== "category" && id !== "status" && id !== "updatedAt") continue;
      const comparison = a[id].localeCompare(b[id], undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (comparison) return desc ? -comparison : comparison;
    }
    return a.activity.id.localeCompare(b.activity.id);
  });
  const start = (params.page - 1) * params.pageSize;
  return { rows: matching.slice(start, start + params.pageSize), total: matching.length };
}
