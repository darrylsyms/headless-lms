const pending = new Map<string, Promise<unknown>>();

export function queueActivitySave<T>(activityId: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(activityId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pending.set(activityId, current);
  void current.finally(() => { if (pending.get(activityId) === current) pending.delete(activityId); }).catch(() => undefined);
  return current;
}
