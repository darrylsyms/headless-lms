"use client";

import { useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderTree } from "./folder-tree";
import {
  assignMediaFolderAction,
  createMediaFolderAction,
  deleteMediaFolderAction,
  updateMediaFolderAction,
  type MediaFolder,
} from "../actions";

const schema = z.object({ name: z.string().trim().min(1).max(100), parentId: z.string() });
type Values = z.infer<typeof schema>;

export function FolderManager({
  folders,
  selected,
  onSelect,
  canWrite,
  selectedAssets,
  onMoved,
}: {
  folders: MediaFolder[];
  selected: string;
  onSelect: (id: string) => void;
  canWrite: boolean;
  selectedAssets: string[];
  onMoved: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [destination, setDestination] = useState("unfiled");
  const current = folders.find((f) => f.id === selected);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", parentId: "root" },
  });
  const parentId = useWatch({ control: form.control, name: "parentId" });
  function open(which: "create" | "edit") {
    form.reset({
      name: which === "edit" ? (current?.name ?? "") : "",
      parentId: which === "edit" ? (current?.parentId ?? "root") : (current?.id ?? "root"),
    });
    setMode(which);
  }
  function submit(values: Values) {
    start(async () => {
      try {
        if (mode === "create")
          await createMediaFolderAction(
            values.name,
            values.parentId === "root" ? null : values.parentId,
          );
        else if (current)
          await updateMediaFolderAction(current.id, {
            name: values.name,
            parentId: values.parentId === "root" ? null : values.parentId,
          });
        setMode(null);
        router.refresh();
        toast.success(mode === "create" ? "Folder created" : "Folder updated");
      } catch (error) {
        toast.error("Couldn't save folder", { description: (error as Error).message });
      }
    });
  }
  function move(assetIds: string[], folderId: string | null) {
    start(async () => {
      try {
        await assignMediaFolderAction(assetIds, folderId);
        onMoved();
        router.refresh();
        toast.success("Files moved");
      } catch (error) {
        toast.error("Couldn't move files", { description: (error as Error).message });
      }
    });
  }
  function drop(event: DragEvent, folderId: string | null) {
    const folder = event.dataTransfer.getData("application/x-fretwise-folder");
    const file = event.dataTransfer.getData("application/x-fretwise-assets");
    if (folder)
      start(async () => {
        try {
          await updateMediaFolderAction(folder, { parentId: folderId });
          router.refresh();
        } catch (error) {
          toast.error("Couldn't move folder", { description: (error as Error).message });
        }
      });
    else if (file) {
      try {
        const ids: unknown = JSON.parse(file);
        if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) move(ids, folderId);
      } catch {}
    }
  }
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 sm:w-56">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Folders</h2>
        {canWrite && (
          <Button size="sm" variant="ghost" onClick={() => open("create")}>
            Add
          </Button>
        )}
      </div>
      <FolderTree
        folders={folders}
        selected={selected}
        onSelect={onSelect}
        onDrop={canWrite ? drop : undefined}
      />
      {canWrite && current && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => open("edit")}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      )}
      {canWrite && selectedAssets.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-3">{selectedAssets.length} selected</p>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger aria-label="Move selected files to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unfiled">Unfiled</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => move(selectedAssets, destination === "unfiled" ? null : destination)}
          >
            Move selected
          </Button>
        </div>
      )}
      <FormDialog
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === "edit" ? "Edit folder" : "Add folder"}
        formId="media-folder-form"
        pending={pending}
      >
        <form
          id="media-folder-form"
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit(submit)}
        >
          <Field
            id="folder-name"
            label="Folder name"
            required
            error={form.formState.errors.name?.message}
          >
            <Input id="folder-name" {...form.register("name")} />
          </Field>
          <Field id="folder-parent" label="Parent folder">
            <Select
              value={parentId}
              onValueChange={(value) => form.setValue("parentId", value)}
            >
              <SelectTrigger id="folder-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">No parent folder</SelectItem>
                {folders
                  .filter((f) => f.id !== current?.id || mode === "create")
                  .map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </form>
      </FormDialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this folder?"
        description="This deletes the folder and all its subfolders. Their files are kept and moved to Unfiled."
        confirmLabel="Delete folders"
        pending={pending}
        onConfirm={() => {
          if (!current) return;
          start(async () => {
            try {
              await deleteMediaFolderAction(current.id);
              setConfirm(false);
              onSelect("unfiled");
              router.refresh();
              toast.success("Folders deleted");
            } catch (error) {
              toast.error("Couldn't delete folder", { description: (error as Error).message });
            }
          });
        }}
      />
    </aside>
  );
}
