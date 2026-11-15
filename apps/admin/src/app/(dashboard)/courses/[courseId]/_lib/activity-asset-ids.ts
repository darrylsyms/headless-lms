import type { EditorModule } from "@headless-lms/editor";

import type { ActivityContent } from "@/lib/api/types";

type Editor = Pick<EditorModule, "assetIds" | "meta">;

export function activityAssetIds(
  editor: Editor,
  content: ActivityContent | undefined,
): string[] | undefined {
  if (!content || content.type !== editor.meta.type || content.version !== editor.meta.version) {
    return undefined;
  }
  return editor.assetIds(content.config);
}

export function activityAssetIdsWithArtwork(
  contentIds: string[] | undefined,
  currentIds: string[],
  previousArtwork: string | null | undefined,
  artwork: string | null | undefined,
  contentKnown: boolean,
): string[] {
  const ids = contentIds ?? currentIds;
  const retained = ids.filter(
    (id) => id !== previousArtwork || id === artwork || !contentKnown || contentIds?.includes(id),
  );
  return [...new Set([...retained, ...(artwork ? [artwork] : [])])];
}
