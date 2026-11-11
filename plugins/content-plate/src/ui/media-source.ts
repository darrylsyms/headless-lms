import { vimeoEmbed } from "./vimeo-embed";
import type { SlateEditor, TElement } from "platejs";
import { KEYS } from "platejs";

export type MediaSource = { url: string; assetId?: string; isUpload?: boolean; name?: string };

export function mediaSourceTarget(block: TElement | undefined): TElement | undefined {
  if (!block) return undefined;
  if ([KEYS.img, KEYS.video, KEYS.audio, KEYS.file].some((type) => type === block.type))
    return block;
  if (block.type !== KEYS.p || !Array.isArray(block.children)) return undefined;
  const media = block.children.filter(
    (child): child is TElement => "type" in child && child.type === KEYS.img,
  );
  const otherContent = block.children.some(
    (child) =>
      child !== media[0] &&
      (!("text" in child) ||
        typeof child.text !== "string" ||
        child.text.replace(/[\s\u200B\uFEFF]/g, "") !== ""),
  );
  return media.length === 1 && !otherContent ? media[0] : undefined;
}

export function replaceMediaSource(
  editor: SlateEditor,
  element: TElement,
  source: MediaSource,
): boolean {
  const path =
    typeof element.id === "string"
      ? editor.api.node({ id: element.id, at: [] })?.[1]
      : editor.api.findPath(element);
  if (!path) return false;
  editor.tf.withoutNormalizing(() => {
    editor.tf.unsetNodes(
      [
        "assetId",
        "url",
        "isUpload",
        "name",
        "initialHeight",
        "initialWidth",
        "placeholderId",
        "fromPlaceholderId",
      ],
      { at: path },
    );
    editor.tf.setNodes(source, { at: path });
  });
  return true;
}

export function mediaSourceUrl(
  value: string,
  kind: "image" | "video" | "audio" | "file",
): string | null {
  const input = value.trim();
  if (kind === "video" && input.startsWith("<")) return vimeoEmbed(input) ? input : null;
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function isEmbeddedVideo(url: string): boolean {
  if (vimeoEmbed(url)) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}
