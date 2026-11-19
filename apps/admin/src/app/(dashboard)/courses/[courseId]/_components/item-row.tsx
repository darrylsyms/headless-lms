"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, FileText, Film, GripVertical, SlidersHorizontal, Trash2 } from "lucide-react";

import { toast } from "sonner";

import { RowActions } from "@/components/data-table/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { containsVideoBlock } from "@/lib/activity-video";
import { activityPublished } from "@/lib/api/compose";
import type { Activity, ActivitySettings } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { deleteActivityAction, setActivityPublishedAction } from "../actions";

/** Read the opaque settings blob as the admin-side shape. */
function settingsOf(activity: Activity): ActivitySettings {
  return (activity.settings ?? {}) as ActivitySettings;
}

export function ActivityIcon({ content }: { content: ActivitySettings["content"] }) {
  const video = containsVideoBlock(content?.config);
  const Icon = video ? Film : FileText;
  return (
    <span role="img" aria-label={video ? "Video activity" : "Written activity"} className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

export function ItemRow({
  item,
  courseId,
  moduleId,
  canEdit,
  reordering = false,
  topicCount = 0,
}: {
  item: Activity;
  courseId: string;
  moduleId: string;
  canEdit: boolean;
  reordering?: boolean;
  topicCount?: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: item.id,
      data: { kind: item.parentActivityId ? "topic" : "activity", moduleId, parentActivityId: item.parentActivityId },
      disabled: !canEdit || reordering,
    });

  const settings = settingsOf(item);
  const published = activityPublished(settings);
  const title = settings.title?.trim() || "Untitled activity";
  const kind = item.parentActivityId ? "topic" : "activity";

  function onTogglePublish() {
    const next = !published;
    startTransition(async () => {
      try {
        await setActivityPublishedAction(courseId, moduleId, item.id, next);
        toast.success(next ? `${kind === "topic" ? "Topic" : "Activity"} published` : "Moved to draft");
      } catch (err) {
        toast.error("Something went wrong", { description: (err as Error).message });
      }
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      try {
        await deleteActivityAction(courseId, moduleId, item.id);
        toast.success(kind === "topic" ? "Topic deleted" : "Activity deleted");
        setConfirmOpen(false);
      } catch (err) {
        toast.error("Something went wrong", { description: (err as Error).message });
      }
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.25 : undefined,
      }}
      className={cn(
        "group flex items-center gap-3 rounded-md border border-transparent bg-surface px-2 py-2 transition-colors hover:border-line hover:bg-surface-2",
        isDragging && "relative z-10 border-line bg-surface-2 shadow-sm",
        isOver && !isDragging && "border-brand bg-surface-2",
      )}
    >
      {canEdit ? (
        <button
          type="button"
          aria-label="Reorder item"
          className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-4 outline-none transition-colors hover:bg-hover hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-7 shrink-0" aria-hidden />
      )}

      <ActivityIcon content={settings.content} />

      {canEdit ? (
        <Link
          href={`/courses/${courseId}/content/${item.id}`}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          <span className="text-xs text-ink-4">{published ? "Published" : "Draft"}</span>
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          <span className="text-xs text-ink-4">{published ? "Published" : "Draft"}</span>
        </div>
      )}

      {canEdit ? (
        <RowActions label="Item actions">
          <DropdownMenuItem asChild>
            <Link href={`/courses/${courseId}/content/${item.id}`}>
              <FileText className="size-4" />
              Edit content
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/courses/${courseId}/content/${item.id}?panel=settings`}>
              <SlidersHorizontal className="size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePublish} disabled={isPending}>
            {published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {published ? "Unpublish" : "Publish"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="danger" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </RowActions>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={kind === "topic" ? "Delete topic" : "Delete activity"}
        description={
          <>
            Delete <span className="font-medium text-ink">{title}</span>{topicCount ? ` and its ${topicCount} ${topicCount === 1 ? "topic" : "topics"}` : ""}? This can&apos;t be undone.
          </>
        }
        confirmLabel={kind === "topic" ? "Delete topic" : "Delete activity"}
        pending={isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
