"use client";

import { Replace } from "lucide-react";
import { KEYS, type TElement, type TMediaElement } from "platejs";
import { useEditorRef, useElement } from "platejs/react";
import { Dialog } from "radix-ui";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { usePickAsset } from "../hooks/use-pick-asset";
import { getErrorMessage, type UploadedFile, useUploadFile } from "../hooks/use-upload-file";
import { Button } from "./button";
import { Input } from "./input";
import { isEmbeddedVideo, mediaSourceUrl, replaceMediaSource, type MediaSource } from "./media-source";
import { ToolbarButton } from "./toolbar";

type MediaKind = "image" | "video" | "audio" | "file";
const MediaSourceContext = createContext<(element: TElement) => void>(() => {});
export const useOpenMediaSource = () => useContext(MediaSourceContext);

function mediaKind(element: TElement | null): MediaKind {
  if (element?.type === KEYS.img) return "image";
  if (element?.type === KEYS.video) return "video";
  if (element?.type === KEYS.audio) return "audio";
  return "file";
}

export function MediaSourceProvider({ children }: { children: ReactNode }) {
  const editor = useEditorRef();
  const pickAsset = usePickAsset();
  const { uploadFile, isUploading } = useUploadFile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [element, setElement] = useState<TElement | null>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const kind = mediaKind(element);
  const label = kind;

  const openSource = useCallback((target: TElement) => {
    setElement(target);
    setUrl(typeof target.assetId === "string" ? "" : typeof target.url === "string" ? target.url : "");
    setError("");
    setOpen(true);
  }, []);
  function replaceSource(target: TElement, source: MediaSource) {
    if (!replaceMediaSource(editor, target, source)) {
      toast.error(`Couldn't replace ${label}`, { description: "The block is no longer available." });
      return;
    }
    setError("");
    setOpen(false);
  }
  function useAsset(target: TElement, file: UploadedFile) {
    replaceSource(target, { url: file.url, ...(file.id ? { assetId: file.id } : {}), isUpload: true, name: file.name });
  }
  async function browse() {
    if (!pickAsset || !element) return;
    const target = element;
    setOpen(false);
    setPicking(true);
    try {
      const file = await pickAsset({ kind });
      if (file) useAsset(target, file);
    } catch (err) {
      toast.error(`Couldn't replace ${label}`, { description: getErrorMessage(err) });
    } finally {
      setPicking(false);
    }
  }
  return (
    <MediaSourceContext.Provider value={openSource}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-[101] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg bg-popover p-5 text-popover-foreground shadow-floating outline-hidden">
            <Dialog.Title className="text-base font-medium">Replace {label}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">Choose a replacement or enter a link.</Dialog.Description>
            <form className="flex flex-col gap-2" onSubmit={(event) => {
              event.preventDefault();
              if (!element) return;
              const value = mediaSourceUrl(url, kind);
              if (!value) {
                setError(kind === "video" ? "Enter a valid video URL or Vimeo embed code." : `Enter a valid ${label} URL.`);
                return;
              }
              const name = kind === "file" ? new URL(value).pathname.split("/").pop() || "File" : undefined;
              replaceSource(element, { url: value, isUpload: kind === "video" && !isEmbeddedVideo(value), ...(name ? { name } : {}) });
            }}>
              <Input aria-label={`${label[0].toUpperCase()}${label.slice(1)} URL`} placeholder={kind === "video" ? "Video URL or Vimeo embed code" : `${label[0].toUpperCase()}${label.slice(1)} URL`} value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} />
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <Button type="submit" variant="brand" className="w-full">Use link</Button>
            </form>
            <div className="flex gap-2">
              {pickAsset && <Button type="button" variant="outline" className="flex-1" onClick={() => void browse()} disabled={picking || isUploading}>Choose from library</Button>}
              <Button type="button" variant="outline" className="flex-1" onClick={() => fileInput.current?.click()} disabled={picking || isUploading}>{isUploading ? "Uploading…" : "Upload"}</Button>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" className="self-end">Cancel</Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <input ref={fileInput} type="file" className="hidden" accept={kind === "file" ? undefined : `${kind}/*`} aria-label={`Upload replacement ${label}`} onChange={(event) => {
        const file = event.target.files?.[0];
        const target = element;
        event.target.value = "";
        if (file && target) void uploadFile(file).then((result) => { if (result) useAsset(target, result); });
      }} />
    </MediaSourceContext.Provider>
  );
}

export function MediaSourceButton({ variant }: { variant: "media" | "default" }) {
  const element = useElement<TMediaElement>();
  const openSource = useOpenMediaSource();
  const label = mediaKind(element);
  return <ToolbarButton aria-label={`Replace ${label}`} tooltip={`Replace ${label}`} variant={variant} size={variant === "media" ? "none" : "sm"} onClick={(event) => { event.stopPropagation(); openSource(element); }}><Replace /></ToolbarButton>;
}
