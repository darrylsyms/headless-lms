import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { deserializeMd, remarkMdx } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

import { activityToMarkdown } from "./markdown";
import { BaseEditorKit } from "./editor/editor-base-kit";

describe("activity Markdown", () => {
  it("preserves common formatting and tables through export and import", () => {
    const editor = createSlateEditor({ plugins: BaseEditorKit });
    const original = "# Heading\n\nA **bold** and *italic* [link](https://example.com).\n\n- One\n- Two\n\n| Name | Number |\n| --- | --- |\n| One | 1 |\n";
    const nodes = deserializeMd(editor, original, { remarkPlugins: [remarkGfm, remarkMdx] });
    const result = activityToMarkdown(nodes, {});
    expect(result).toContain("# Heading");
    expect(result).toContain("**bold**");
    expect(result).toContain("https://example.com");
    expect(result).toContain("| Name");
    const roundTrip = deserializeMd(editor, result, { remarkPlugins: [remarkGfm, remarkMdx] });
    expect(JSON.stringify(roundTrip)).toContain('"type":"table"');
  });
  it("preserves video and image blocks in Markdown", () => {
    const editor = createSlateEditor({ plugins: BaseEditorKit });
    const nodes = [
      { type: "video", url: "https://vimeo.com/123456", children: [{ text: "" }] },
      { type: "img", url: "https://example.com/picture.png", children: [{ text: "" }] },
    ];
    const result = activityToMarkdown(nodes, {});
    expect(result).toContain("https://vimeo.com/123456");
    expect(result).toContain("https://example.com/picture.png");
    const roundTrip = deserializeMd(editor, result, { remarkPlugins: [remarkGfm, remarkMdx] });
    expect(JSON.stringify(roundTrip)).toContain('"type":"video"');
    expect(JSON.stringify(roundTrip)).toContain('"type":"img"');
  });
});
