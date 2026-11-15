import { describe, expect, it } from "vitest";

import { activityAssetIds, activityAssetIdsWithArtwork } from "./activity-asset-ids";

const editor = {
  meta: { type: "plate", version: 1 },
  assetIds: (config: unknown) => (config as { ids: string[] }).ids,
};

const content = (ids: string[], type = "plate") => ({ type, version: 1, config: { ids } });

describe("activityAssetIds", () => {
  it("links exactly the media the editor content uses", () => {
    expect(activityAssetIds(editor, content(["ast_video", "ast_image"]))).toEqual([
      "ast_video",
      "ast_image",
    ]);
    expect(activityAssetIds(editor, content([]))).toEqual([]);
  });

  it("leaves the links alone for content this editor cannot read, or none", () => {
    expect(activityAssetIds(editor, content(["ast_new"], "tiptap"))).toBeUndefined();
    expect(activityAssetIds(editor, undefined)).toBeUndefined();
  });
});

describe("activity artwork links", () => {
  it("keeps artwork attached when lesson content changes", () => {
    expect(activityAssetIdsWithArtwork(["video"], [], null, "art", true)).toEqual(["video", "art"]);
  });

  it("replaces artwork while keeping other linked assets", () => {
    expect(activityAssetIdsWithArtwork(undefined, ["video", "old"], "old", "new", true)).toEqual([
      "video",
      "new",
    ]);
  });

  it("retains a former artwork link when the content format cannot be inspected", () => {
    expect(activityAssetIdsWithArtwork(undefined, ["video", "old"], "old", null, false)).toEqual([
      "video",
      "old",
    ]);
  });

  it("retains artwork also used by the lesson content", () => {
    expect(activityAssetIdsWithArtwork(["old"], [], "old", null, true)).toEqual(["old"]);
  });
});
