import type { ModuleTree } from "@/lib/api/types";

export function activityModule(
  modules: ModuleTree[],
  activityId: string | number,
): ModuleTree | undefined {
  return modules.find((module) => module.activities.some((activity) => activity.id === activityId));
}

export function targetModule(
  modules: ModuleTree[],
  targetId: string | number,
): ModuleTree | undefined {
  return modules.find(
    (module) =>
      module.id === targetId || module.activities.some((activity) => activity.id === targetId),
  );
}

export function placeActivity(
  modules: ModuleTree[],
  activityId: string,
  destinationId: string,
  beforeId: string | null,
): ModuleTree[] {
  const source = activityModule(modules, activityId);
  const destination = modules.find((module) => module.id === destinationId);
  if (!source || !destination) return modules;
  const item = source.activities.find((activity) => activity.id === activityId);
  if (!item || item.parentActivityId) return modules;
  const moving = source.activities.filter((activity) => activity.id === activityId || activity.parentActivityId === activityId);
  const movingIds = new Set(moving.map((activity) => activity.id));
  const remaining = destination.activities.filter((activity) => !movingIds.has(activity.id));
  const index = beforeId ? remaining.findIndex((activity) => activity.id === beforeId) : -1;
  remaining.splice(index < 0 ? remaining.length : index, 0, ...moving.map(activity => ({ ...activity, moduleId: destinationId })));
  if (
    source.id === destination.id &&
    remaining.every((activity, i) => activity.id === source.activities[i]?.id)
  )
    return modules;
  return modules.map((module) =>
    module.id === destinationId
      ? { ...module, activities: remaining }
      : module.id === source.id
        ? {
            ...module,
            activities: module.activities.filter((activity) => !movingIds.has(activity.id)),
          }
        : module,
  );
}

export function placeTopic(modules: ModuleTree[], topicId: string, parentId: string, beforeId: string | null): ModuleTree[] {
  const source = activityModule(modules, topicId);
  const destination = activityModule(modules, parentId);
  const topic = source?.activities.find(item => item.id === topicId);
  const parent = destination?.activities.find(item => item.id === parentId);
  if (!source || !destination || !topic?.parentActivityId || !parent || parent.parentActivityId) return modules;
  const remaining = destination.activities.filter(item => item.id !== topicId);
  const siblings = remaining.filter(item => item.parentActivityId === parentId);
  const index = beforeId ? remaining.findIndex(item => item.id === beforeId && item.parentActivityId === parentId) : -1;
  const insert = index >= 0 ? index : siblings.length ? remaining.findIndex(item => item.id === siblings[siblings.length - 1].id) + 1 : remaining.findIndex(item => item.id === parentId) + 1;
  remaining.splice(insert, 0, { ...topic, moduleId: destination.id, parentActivityId: parentId });
  if (source.id === destination.id && remaining.every((item, i) => item.id === source.activities[i]?.id)) return modules;
  return modules.map(module => module.id === destination.id ? { ...module, activities: remaining } : module.id === source.id ? { ...module, activities: module.activities.filter(item => item.id !== topicId) } : module);
}
