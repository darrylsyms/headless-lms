import Player from "@vimeo/player";

type LessonDuration = { kind: "video" | "written"; minutes: number | null; basis: "video" | "notes" };

export function firstContentIndex(config: unknown[]): number {
  const emptyText = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every(emptyText);
    if (!value || typeof value !== "object") return false;
    const node = value as { text?: unknown; type?: unknown; children?: unknown };
    if (typeof node.text === "string") return node.text.replace(/[\s\u200B\uFEFF]/g, "").length === 0;
    return !node.type && Array.isArray(node.children) && emptyText(node.children);
  };
  let index = 0;
  while (index < config.length) {
    const node = config[index] as { type?: unknown; children?: unknown } | null;
    if (!node || node.type !== "p" || !Array.isArray(node.children) || !emptyText(node.children)) break;
    index++;
  }
  return index;
}

export async function calculateLessonDuration(config: unknown, assets: Record<string, string>): Promise<LessonDuration> {
  if (!Array.isArray(config)) return { kind: "written", minutes: null, basis: "notes" };
  const first = config[firstContentIndex(config)];
  const video = first?.type === "video" ? first : null;
  const containsVideo = (value: unknown): boolean => Array.isArray(value) ? value.some(containsVideo) : !!value && typeof value === "object" && ((value as { type?: string }).type === "video" || containsVideo((value as { children?: unknown }).children));
  if (!video) {
    const words: string[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (["video", "file", "img"].includes(String(node.type))) return;
      if (typeof node.text === "string") words.push(node.text);
      if (Array.isArray(node.children)) visit(node.children);
    };
    visit(config);
    const text = words.join(" ").trim();
    return { kind: containsVideo(config) ? "video" : "written", basis: "notes", minutes: text ? Math.max(1, Math.ceil(text.split(/\s+/).length / 200)) : null };
  }
  let raw = typeof video.assetId === "string" ? assets[video.assetId] : video.url;
  if (typeof raw !== "string") return { kind: "video", minutes: null, basis: "video" };
  if (raw.trimStart().startsWith("<")) {
    const match = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!match) return { kind: "video", minutes: null, basis: "video" };
    raw = match[1].replace(/&amp;/g, "&");
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" || parsed.hostname !== "player.vimeo.com" || !/^\/video\/\d+\/?$/.test(parsed.pathname)) return { kind: "video", minutes: null, basis: "video" };
    } catch { return { kind: "video", minutes: null, basis: "video" }; }
  }
  let url: URL;
  try { url = new URL(raw, window.location.origin); } catch { return { kind: "video", minutes: null, basis: "video" }; }
  if (!["http:", "https:"].includes(url.protocol)) return { kind: "video", minutes: null, basis: "video" };
  let cleanup = () => {};
  try {
    let read: Promise<number>;
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
      if (!match) return { kind: "video", minutes: null, basis: "video" };
      const embed = new URL(`https://player.vimeo.com/video/${match[1]}`);
      const hash = url.searchParams.get("h") ?? match[2];
      if (hash && /^[a-zA-Z0-9]+$/.test(hash)) embed.searchParams.set("h", hash);
      const iframe = document.createElement("iframe");
      iframe.hidden = true;
      iframe.src = embed.href;
      document.body.appendChild(iframe);
      const player = new Player(iframe);
      cleanup = () => { void player.destroy().catch(() => {}); iframe.remove(); };
      read = player.getDuration();
    } else {
      const element = document.createElement("video");
      element.preload = "metadata";
      cleanup = () => { element.removeAttribute("src"); element.load(); };
      read = new Promise((resolve, reject) => {
        element.onloadedmetadata = () => resolve(element.duration);
        element.onerror = () => reject(new Error("Video metadata unavailable"));
        element.src = url.href;
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seconds = await Promise.race([read, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Video metadata timed out")), 8000); })]).finally(() => clearTimeout(timer));
    return { kind: "video", basis: "video", minutes: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null };
  } catch { return { kind: "video", minutes: null, basis: "video" }; }
  finally { cleanup(); }
}
