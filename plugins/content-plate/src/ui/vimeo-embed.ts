export function vimeoEmbed(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  const match = input.startsWith("<") ? input.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i) : null;
  if (input.startsWith("<") && !match) return null;
  try {
    const url = new URL((match?.[1] ?? input).replace(/&amp;/g, "&"));
    if (url.protocol !== "https:" || !["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)) return null;
    const path = url.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
    if (!path) return null;
    const embed = new URL(`https://player.vimeo.com/video/${path[1]}`);
    const hash = url.searchParams.get("h") ?? path[2];
    if (hash && /^[a-zA-Z0-9]+$/.test(hash)) embed.searchParams.set("h", hash);
    return embed.href;
  } catch { return null; }
}
