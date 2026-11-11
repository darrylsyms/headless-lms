import { MarkdownPlugin, remarkMdx, serializeMd } from "@platejs/markdown";
import { createSlateEditor, type Value } from "platejs";
import remarkGfm from "remark-gfm";

import { withAssetUrls } from "./asset-urls";
import { BaseEditorKit } from "./editor/editor-base-kit";
import { isNodeList } from "./validate";

export function activityToMarkdown(config: unknown, assetUrls: Record<string, string>): string {
  const value = isNodeList(config) ? withAssetUrls(config as Value, assetUrls) : [];
  const editor = createSlateEditor({ plugins: [...BaseEditorKit, MarkdownPlugin], value });
  return serializeMd(editor, { value, remarkPlugins: [remarkGfm, remarkMdx] });
}
