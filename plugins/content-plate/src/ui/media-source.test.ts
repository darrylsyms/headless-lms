import { describe, expect, it } from "vitest";
import { createSlateEditor, type TElement } from "platejs";
import { assetIds } from "../asset-ids";
import {
  isEmbeddedVideo,
  mediaSourceTarget,
  mediaSourceUrl,
  replaceMediaSource,
} from "./media-source";

describe("media replacement", () => {
  it.each(["img", "video", "audio", "file"])(
    "replaces the %s asset while keeping the block and caption",
    (type) => {
      const node = {
        id: "block-1",
        type,
        assetId: "ast_old",
        url: "https://example.com/old",
        isUpload: true,
        initialWidth: 300,
        caption: [{ children: [{ text: "My caption" }] }],
        children: [{ text: "" }],
      };
      const editor = createSlateEditor({ value: [node] });
      expect(
        replaceMediaSource(editor, node as TElement, {
          url: "https://example.com/new",
          assetId: "ast_new",
          isUpload: true,
          name: "new-file",
        }),
      ).toBe(true);
      const updated = editor.children[0] as TElement;
      expect(updated.id).toBe("block-1");
      expect(updated.type).toBe(type);
      expect(updated.caption).toEqual(node.caption);
      expect(updated.initialWidth).toBeUndefined();
      expect(assetIds(editor.children)).toEqual(["ast_new"]);
      expect(updated.url).toBe("https://example.com/new");
      expect(
        replaceMediaSource(editor, updated, {
          url: "https://example.com/external",
          isUpload: false,
        }),
      ).toBe(true);
      expect(assetIds(editor.children)).toEqual([]);
      expect((editor.children[0] as TElement).url).toBe("https://example.com/external");
    },
  );
  it("accepts HTTP links and Vimeo embed code while rejecting unsafe links", () => {
    expect(mediaSourceUrl(" https://example.com/photo.png ", "image")).toBe(
      "https://example.com/photo.png",
    );
    expect(mediaSourceUrl("https://example.com/audio.mp3", "audio")).toBe(
      "https://example.com/audio.mp3",
    );
    expect(mediaSourceUrl("https://example.com/notes.pdf", "file")).toBe(
      "https://example.com/notes.pdf",
    );
    const embed = '<iframe src="https://player.vimeo.com/video/12345?h=abc"></iframe>';
    expect(mediaSourceUrl(embed, "video")).toBe(embed);
    expect(isEmbeddedVideo(embed)).toBe(true);
    expect(isEmbeddedVideo("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isEmbeddedVideo("https://example.com/video.mp4")).toBe(false);
    expect(mediaSourceUrl("javascript:alert(1)", "image")).toBeNull();
    expect(mediaSourceUrl('<iframe src="https://evil.example/"></iframe>', "video")).toBeNull();
  });

  it("finds and replaces an image nested in a paragraph without changing its wrapper", () => {
    const image = {
      id: "image-1",
      type: "img",
      url: "https://example.com/old.png",
      children: [{ text: "" }],
    };
    const block = { id: "paragraph-1", type: "p", children: [image] };
    const editor = createSlateEditor({ value: [block] });
    expect(mediaSourceTarget(block as TElement)?.id).toBe("image-1");
    expect(
      replaceMediaSource(editor, image as TElement, { url: "https://example.com/new.png" }),
    ).toBe(true);
    expect(editor.children[0]).toMatchObject({
      id: "paragraph-1",
      type: "p",
      children: [{ id: "image-1", type: "img", url: "https://example.com/new.png" }],
    });
  });

  it("does not guess which image to replace in mixed or multi-image paragraphs", () => {
    const image = { id: "image-1", type: "img", children: [{ text: "" }] };
    expect(
      mediaSourceTarget({ type: "p", children: [image, { text: "Text" }] } as TElement),
    ).toBeUndefined();
    expect(
      mediaSourceTarget({ type: "p", children: [image, { ...image, id: "image-2" }] } as TElement),
    ).toBeUndefined();
  });
});
