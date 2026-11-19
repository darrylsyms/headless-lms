export function selectMedia(
  selected: string[],
  visibleIds: string[],
  id: string,
  anchor: string | null,
  range: boolean,
): string[] {
  const start = anchor === null ? -1 : visibleIds.indexOf(anchor);
  const end = visibleIds.indexOf(id);
  if (range && start >= 0 && end >= 0) {
    const ids = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    return [...new Set([...selected, ...ids])];
  }
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}
