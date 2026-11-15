export function containsVideoBlock(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsVideoBlock);
  if (!value || typeof value !== "object") return false;
  const node = value as { type?: unknown; children?: unknown };
  return node.type === "video" || containsVideoBlock(node.children);
}
