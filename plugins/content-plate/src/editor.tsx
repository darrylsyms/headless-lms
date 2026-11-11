"use client";

// Contract entry: the interactive Notion-style editor. A pure document
// surface — no chrome, no border, no inner scroll region: the page scrolls.
// Slash commands, drag handles, block selection, floating toolbar, and media
// all come from the kits. Save UI belongs to the host (via `onChange`);
// Ctrl/Cmd+S triggers `onSave` directly.
import { RangeApi, type Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { useEffect } from "react";

import type { PageEditorProps } from "@headless-lms/editor";

import { withAssetUrls, withoutAssetUrls } from "./asset-urls";

import { EditorKit } from "./editor/editor-kit";
import { HostSlotsProvider } from "./hooks/use-host-slots";
import { PickAssetProvider } from "./hooks/use-pick-asset";
import { UploadProvider } from "./hooks/use-upload-file";
import { Editor as EditorArea, EditorContainer } from "./ui/editor";
import { MediaSourceProvider } from "./ui/media-source-button";
import { isNodeList } from "./validate";

const EMPTY_VALUE: Value = [{ type: "p", children: [{ text: "" }] }];
const NO_SLOTS = {};

export function Editor({
  initialConfig,
  onChange,
  onSave,
  pickAsset,
  assetUrls,
  uploadFile,
  slots,
}: PageEditorProps) {
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: isNodeList(initialConfig)
      ? withAssetUrls(initialConfig as Value, assetUrls)
      : EMPTY_VALUE,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void onSave(withoutAssetUrls(editor.children));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, onSave]);

  return (
    <UploadProvider uploadFile={uploadFile ?? null}>
      <PickAssetProvider pickAsset={pickAsset ?? null}>
        <HostSlotsProvider slots={slots ?? NO_SLOTS}>
          <Plate editor={editor} onValueChange={({ value }) => onChange?.(withoutAssetUrls(value))}>
            <MediaSourceProvider>
            <EditorContainer className="h-auto !overflow-visible" variant="default">
              <EditorArea
                placeholder="Type '/' for commands…"
                variant="default"
                onKeyDown={(event) => {
                  const selection = editor.selection;
                  const first = editor.children[0] as { type?: string; children?: { text?: string }[] } | undefined;
                  if (event.key !== "Backspace" || event.nativeEvent.isComposing || !selection || !RangeApi.isCollapsed(selection) || selection.anchor.path[0] !== 0 || editor.children.length < 2 || first?.type !== "p" || !Array.isArray(first.children) || !first.children.every((child) => typeof child.text === "string" && child.text.replace(/[\s\u200B\uFEFF]/g, "") === "")) {return;}
                  event.preventDefault();
                  event.stopPropagation();
                  editor.tf.removeNodes({ at: [0] });
                }}
              />
            </EditorContainer>
            </MediaSourceProvider>
          </Plate>
        </HostSlotsProvider>
      </PickAssetProvider>
    </UploadProvider>
  );
}
