import type { Activity } from '../types/index.js';

type VisibleActivity = Pick<Activity, 'id' | 'parentActivityId' | 'settings'>;
export function isPublishedActivity(activity: Pick<Activity, 'settings'>): boolean {
  return (activity.settings as { published?: boolean } | null)?.published !== false;
}
export function publishedActivities<T extends VisibleActivity>(activities: T[]): T[] {
  const parents = new Set(activities.filter(activity => !activity.parentActivityId && isPublishedActivity(activity)).map(activity => activity.id));
  return activities.filter(activity => isPublishedActivity(activity) && (!activity.parentActivityId || parents.has(activity.parentActivityId)));
}
export async function isPublishedWithParent(activity: VisibleActivity, find: (id: string) => Promise<VisibleActivity | null>): Promise<boolean> {
  if (!isPublishedActivity(activity)) { return false; }
  if (!activity.parentActivityId) { return true; }
  const parent = await find(activity.parentActivityId);
  return !!parent && !parent.parentActivityId && isPublishedActivity(parent);
}
