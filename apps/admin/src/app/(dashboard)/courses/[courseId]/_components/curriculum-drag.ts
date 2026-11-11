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
  if (!item) return modules;
  const remaining = destination.activities.filter((activity) => activity.id !== activityId);
  const index = beforeId ? remaining.findIndex((activity) => activity.id === beforeId) : -1;
  remaining.splice(index < 0 ? remaining.length : index, 0, { ...item, moduleId: destinationId });
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
            activities: module.activities.filter((activity) => activity.id !== activityId),
          }
        : module,
  );
}
