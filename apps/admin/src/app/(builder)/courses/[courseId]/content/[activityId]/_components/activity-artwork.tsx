"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { updateActivitySettingsAction } from "@/app/(dashboard)/courses/[courseId]/actions";
import { AssetPickerDialog } from "@/app/(dashboard)/media/_components/asset-picker-dialog";
import { confirmAssetAction, requestUploadAction } from "@/app/(dashboard)/media/actions";
import { putToStorage } from "@/app/(dashboard)/media/upload-to-storage";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { Asset } from "@/lib/api/types";

export function ActivityArtwork({
  courseId,
  moduleId,
  activityId,
  assetId,
  url,
}: {
  courseId: string;
  moduleId: string;
  activityId: string;
  assetId: string | null;
  url: string | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(
    assetId && url ? { id: assetId, url } : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function save(next: { id: string; url: string } | null) {
    const previous = preview;
    setPreview(next);
    setBusy(true);
    try {
      const refusal = await updateActivitySettingsAction(courseId, moduleId, activityId, {
        thumbnailAssetId: next?.id ?? null,
      });
      if (refusal) throw new Error(refusal.refused);
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

  return (
    <Field id="activity-thumbnail-upload" label="Thumbnail" hint="A wide image works best.">
      <div className="flex flex-col gap-3">
        <div className="relative grid aspect-video w-full max-w-56 place-items-center overflow-hidden rounded-card border border-line bg-well">
          {preview ? (
            <Image
              src={preview.url}
              alt=""
              fill
              unoptimized
              sizes="224px"
              className="object-cover"
            />
          ) : (
            <ImageIcon aria-hidden="true" className="size-6 text-ink-4" />
          )}
          {progress !== null && (
            <div className="absolute inset-0 grid place-items-center bg-surface/80 text-xs text-ink-3">
              <Loader2 className="size-4 animate-spin" />
              {Math.round(progress * 100)}%
            </div>
          )}
        </div>
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
          {preview && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              <Trash2 /> Remove
            </Button>
          )}
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
