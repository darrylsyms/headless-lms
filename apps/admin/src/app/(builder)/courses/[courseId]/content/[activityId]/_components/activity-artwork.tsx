"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { updateActivitySettingsAction } from "@/app/(dashboard)/courses/[courseId]/actions";
import { AssetPickerDialog } from "@/app/(dashboard)/media/_components/asset-picker-dialog";
import { confirmAssetAction, requestUploadAction } from "@/app/(dashboard)/media/actions";
import { putToStorage } from "@/app/(dashboard)/media/upload-to-storage";
import { ArtworkRemoveButton } from "@/components/artwork-remove-button";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queueActivitySave } from "./activity-save-queue";
import type { Asset } from "@/lib/api/types";

const subscribeToPlatform = () => () => {};
const platformShortcut = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "⌘B" : "Ctrl+B";

export function ActivityArtwork({
  courseId,
  moduleId,
  activityId,
  assetId,
  url,
  title,
  backgroundUrl,
  isInsider,
  overlay,
}: {
  title: string;
  backgroundUrl: string | null;
  isInsider: boolean;
  overlay?: import("@/lib/api/types").ActivitySettings["thumbnailOverlay"];
  courseId: string;
  moduleId: string;
  activityId: string;
  assetId: string | null;
  url: string | null;
}) {
  const router = useRouter();
  const [overlayEnabled, setOverlayEnabled] = useState(overlay?.enabled ?? (!assetId && !isInsider));
  const [overlayText, setOverlayText] = useState(overlay?.text ?? title);
  const [layout, setLayout] = useState<"left" | "center" | "top" | "bottom">(overlay?.layout ?? "left");
  const initialWidth = typeof overlay?.textWidth === "number" && Number.isInteger(overlay.textWidth) && overlay.textWidth >= 1 && overlay.textWidth <= 100 ? overlay.textWidth : null;
  const [widthInput, setWidthInput] = useState(initialWidth === null ? "" : String(initialWidth));
  const [widthError, setWidthError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(
    assetId && url ? { id: assetId, url } : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const draft = useRef({ enabled: overlay?.enabled ?? (!assetId && !isInsider), text: overlay?.text ?? title, layout: overlay?.layout ?? "left" as "left" | "center" | "top" | "bottom", textWidth: initialWidth });
  const latestSave = useRef<() => void>(() => {});
  const shortcut = useSyncExternalStore(subscribeToPlatform, platformShortcut, () => "");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; latestSave.current(); }
    };
  }, []);

  useEffect(() => {
    if (saveStatus !== "saving" && saveStatus !== "error") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus]);

  const persistOverlay = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const snapshot = { ...draft.current };
    const version = revision.current;
    void queueActivitySave(activityId, async () => {
      const refusal = await updateActivitySettingsAction(courseId, moduleId, activityId, { thumbnailOverlay: snapshot });
      if (refusal) throw new Error(refusal.refused);
    }).then(() => {
      if (mounted.current && revision.current === version) setSaveStatus("saved");
    }).catch(error => {
      if (mounted.current && revision.current === version) setSaveStatus("error");
      toast.error("Couldn't save thumbnail text", { description: (error as Error).message });
    });
  }, [activityId, courseId, moduleId]);
  useEffect(() => { latestSave.current = persistOverlay; }, [persistOverlay]);

  function changeOverlay(patch: Partial<typeof draft.current>) {
    draft.current = { ...draft.current, ...patch };
    revision.current += 1;
    setSaveStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; latestSave.current(); }, 700);
  }

  async function save(next: { id: string; url: string } | null) {
    const previous = preview;
    setPreview(next);
    setBusy(true);
    try {
      const refusal = await queueActivitySave(activityId, () => updateActivitySettingsAction(courseId, moduleId, activityId, {
        thumbnailAssetId: next?.id ?? null,
      }));
      if (refusal) throw new Error(refusal.refused);
      if (!overlay && revision.current === 0) {
        const enabled = !next && !isInsider;
        draft.current.enabled = enabled;
        setOverlayEnabled(enabled);
      }
      toast.success(next ? "Thumbnail updated" : "Thumbnail removed");
      router.refresh();
    } catch (error) {
      setPreview(previous);
      toast.error("Couldn't save thumbnail", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const ticket = await requestUploadAction({
        filename: file.name,
        contentType: file.type,
        contentId: courseId,
      });
      await putToStorage(ticket.uploadUrl, ticket.headers, file, setProgress);
      const asset = await confirmAssetAction(ticket.asset.id);
      if (!asset.url) throw new Error(`${file.name} has not finished uploading`);
      await save({ id: asset.id, url: asset.url });
    } catch (error) {
      toast.error("Upload failed", { description: (error as Error).message });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  function select(asset: Asset) {
    setPickerOpen(false);
    if (!asset.url) {
      toast.error("Couldn't use that file", { description: `${asset.filename} cannot be shown` });
      return;
    }
    void save({ id: asset.id, url: asset.url });
  }

  function toggleHighlight(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
    event.preventDefault();
    const input = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = input;
    if (start === end) return;
    const surrounded = start > 0 && value[start - 1] === "*" && value[end] === "*";
    const selectedWithMarkers = value[start] === "*" && value[end - 1] === "*" && end - start > 2;
    const from = surrounded ? start - 1 : start;
    const to = surrounded ? end + 1 : end;
    const selected = selectedWithMarkers ? value.slice(start + 1, end - 1) : value.slice(start, end);
    const removing = surrounded || selectedWithMarkers;
    const text = value.slice(0, from) + (removing ? selected : `*${selected}*`) + value.slice(to);
    setOverlayText(text);
    changeOverlay({ text });
    const nextStart = from + (removing ? 0 : 1);
    requestAnimationFrame(() => input.setSelectionRange(nextStart, nextStart + selected.length));
  }

  const imageUrl = preview?.url ?? (!isInsider ? backgroundUrl : null);
  const showOverlayControls = !isInsider || !!preview;
  const positions = { left: "items-center justify-start text-left", center: "items-center justify-center text-center", top: "items-start justify-center text-center", bottom: "items-end justify-center text-center" };
  const saveIndicator = saveStatus !== "idle" ? <span role="status" className="text-sm text-ink-3">{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : <>Couldn’t save. <button type="button" className="underline" onClick={persistOverlay}>Retry</button></>}</span> : null;
  return (
    <Field id="activity-thumbnail-upload" label="Thumbnail" hint="A wide image works best.">
      <div className="flex flex-col gap-3">
        <div className="group relative grid aspect-video w-full max-w-56 place-items-center overflow-hidden rounded-card border border-line bg-well">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              unoptimized
              sizes="224px"
              className="object-cover"
            />
          ) : (
            <ImageIcon aria-hidden="true" className="size-6 text-ink-4" />
          )}
          {imageUrl && overlayEnabled && <div aria-hidden style={{ containerType: "inline-size" }} className={`pointer-events-none absolute inset-0 flex p-[5%] ${positions[layout]}`}><p className="whitespace-pre-wrap font-extrabold leading-[1.05] text-white" style={{ width: `${widthInput !== "" && Number(widthInput) >= 1 && Number(widthInput) <= 100 ? Number(widthInput) : layout === "left" ? 65 : 80}%`, fontSize: "7.5cqw", fontFamily: "Rubik Variable, sans-serif", textShadow: "0 0.35cqw 0.8cqw rgba(0,0,0,0.9), 0 0 0.2cqw rgba(0,0,0,0.75)" }}>{overlayText.split(/(\*[^*]+\*)/g).map((part, i) => <span key={i} style={part.startsWith("*") && part.endsWith("*") ? { color: "#f24b4b" } : undefined}>{part.startsWith("*") && part.endsWith("*") ? part.slice(1, -1) : part}</span>)}</p></div>}
          {preview && <ArtworkRemoveButton label="Remove activity thumbnail" disabled={busy} onClick={() => void save(null)} />}
          {progress !== null && (
            <div className="absolute inset-0 grid place-items-center bg-surface/80 text-xs text-ink-3">
              <Loader2 className="size-4 animate-spin" />
              {Math.round(progress * 100)}%
            </div>
          )}
        </div>
        {showOverlayControls && <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overlayEnabled} onChange={e => { setOverlayEnabled(e.target.checked); changeOverlay({ enabled: e.target.checked }); }} /> Show text overlay</label>{!overlayEnabled && saveIndicator}</div>}
        {!showOverlayControls && saveStatus === "error" && saveIndicator}
        {showOverlayControls && overlayEnabled && <>
          <Field id="thumbnail-overlay-text" label="Thumbnail text" labelAside={saveIndicator} hint={shortcut ? `Select text and press ${shortcut} to highlight. Line breaks are preserved.` : "Select text to highlight. Line breaks are preserved."}>
            <textarea id="thumbnail-overlay-text" className="w-full rounded-md border border-line bg-surface p-2 text-sm" rows={3} value={overlayText} onChange={e => { setOverlayText(e.target.value); changeOverlay({ text: e.target.value }); }} onKeyDown={toggleHighlight} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
            <Field id="thumbnail-overlay-layout" label="Text position">
              <Select value={layout} onValueChange={value => { const next = value as typeof layout; setLayout(next); changeOverlay({ layout: next }); }}>
                <SelectTrigger id="thumbnail-overlay-layout"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="top">Top</SelectItem>
                  <SelectItem value="bottom">Bottom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="thumbnail-text-width" label="Width %" error={widthError}>
              <Input id="thumbnail-text-width" type="number" min={1} max={100} placeholder={layout === "left" ? "65" : "80"} value={widthInput} onChange={event => {
                const value = event.target.value;
                setWidthInput(value);
                if (value === "") { setWidthError(""); changeOverlay({ textWidth: null }); return; }
                const number = Number(value);
                if (!Number.isInteger(number) || number < 1 || number > 100) { setWidthError("Use 1–100."); return; }
                setWidthError("");
                changeOverlay({ textWidth: number });
              }} />
            </Field>
          </div>
        </>}
        <input
          id="activity-thumbnail-upload"
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload /> Upload
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPickerOpen(true)}>
            <ImageIcon /> Choose from library
          </Button>

        </div>
      </div>
      <AssetPickerDialog
        open={pickerOpen}
        kind="image"
        contentId={courseId}
        onOpenChange={setPickerOpen}
        onSelect={select}
      />
    </Field>
  );
}
