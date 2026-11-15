"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/data-table/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ActivityNode, ActivitySettings, ModuleTree } from "@/lib/api/types";
import { activityPublished } from "@/lib/api/compose";
import { cn } from "@/lib/utils";

import { ActivityIcon, ItemRow } from "./item-row";
import { activityModule, placeActivity, targetModule } from "./curriculum-drag";
import { NewActivityDialog } from "./new-activity-dialog";
import { EditModuleDialog } from "./edit-module-dialog";
import {
  createModuleAction,
  deleteModuleAction,
  reorderActivitiesAction,
  moveActivityAction,
  reorderModulesAction,
  updateModuleAction,
} from "../actions";

function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

const DND_MODIFIERS = [restrictToVerticalAxis];

const curriculumCollisions: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind;
  const containers = args.droppableContainers.filter((item) =>
    kind === "module"
      ? item.data.current?.kind === "module"
      : item.data.current?.kind === "module" || item.data.current?.kind === "activity",
  );
  const pointer = pointerWithin({ ...args, droppableContainers: containers });
  if (kind === "activity") {
    const isRow = (id: string | number) =>
      containers.find((container) => container.id === id)?.data.current?.kind === "activity";
    const row =
      pointer.find((item) => item.id !== args.active.id && isRow(item.id)) ??
      pointer.find((item) => isRow(item.id));
    if (row) return [row];
  }
  return pointer.length ? pointer : closestCenter({ ...args, droppableContainers: containers });
};

function ActivityDragPreview({ item }: { item: ActivityNode }) {
  const settings = (item.settings ?? {}) as ActivitySettings;
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-2 py-2 shadow-lg">
      <span className="grid size-7 shrink-0 place-items-center text-ink-4">
        <GripVertical className="size-4" />
      </span>
      <ActivityIcon content={settings.content} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink">
          {settings.title?.trim() || "Untitled activity"}
        </span>
        <span className="text-xs text-ink-4">
          {activityPublished(settings) ? "Published" : "Draft"}
        </span>
      </span>
      <span aria-hidden="true" className="w-7 shrink-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One module and its sortable activities.
// ---------------------------------------------------------------------------

function SortableModule({
  module,
  courseId,
  index,
  canEdit,
  reordering,
}: {
  module: ModuleTree;
  courseId: string;
  index: number;
  canEdit: boolean;
  reordering: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const items = module.activities;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(module.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [newItemOpen, setNewItemOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: module.id,
      data: { kind: "module" },
      disabled: !canEdit || reordering,
    });

  function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === module.title) {
      setTitleDraft(module.title);
      return;
    }
    startTransition(async () => {
      try {
        await updateModuleAction(courseId, module.id, next);
        toast.success("Module renamed");
      } catch (err) {
        toast.error("Something went wrong", { description: (err as Error).message });
        setTitleDraft(module.title);
      }
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-card border border-line bg-surface",
        isDragging && "relative z-10 shadow-lg",
        isOver && !isDragging && "border-brand",
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        {canEdit ? (
          <button
            type="button"
            aria-label="Reorder module"
            className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-4 outline-none transition-colors hover:bg-hover hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}

        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-medium text-ink-3 tabular-nums">
          {index + 1}
        </span>

        {editingTitle ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitleDraft(module.title);
                  setEditingTitle(false);
                }
              }}
              className="h-8"
            />
            <Button size="icon-sm" variant="ghost" aria-label="Save title" onClick={saveTitle}>
              <Check className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => {
                setTitleDraft(module.title);
                setEditingTitle(false);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => canEdit && setEditingTitle(true)}
            className={cn(
              "min-w-0 flex-1 truncate rounded-md py-1 text-left text-sm font-medium text-ink outline-none",
              canEdit && "hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            {module.title}
          </button>
        )}

        <span className="shrink-0 text-xs text-ink-4 tabular-nums">
          {module.activities.length} {module.activities.length === 1 ? "activity" : "activities"}
        </span>

        {canEdit ? (
          <RowActions label="Module actions">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit module</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNewItemOpen(true)}>Add activity</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onClick={() => setConfirmOpen(true)}>
              Delete module
            </DropdownMenuItem>
          </RowActions>
        ) : null}
      </div>

      {module.description && (
        <p className="px-3 pt-3 text-sm text-ink-3">{module.description}</p>
      )}

      <div className="px-2 py-2">
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-ink-4">
              No content yet{canEdit ? " — add an activity below." : "."}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  courseId={courseId}
                  moduleId={module.id}
                  canEdit={canEdit}
                  reordering={reordering}
                />
              ))}
            </div>
          )}
        </SortableContext>

        {canEdit ? (
          <div className="flex items-center gap-2 px-1 pt-2">
            <Button size="sm" variant="secondary" onClick={() => setNewItemOpen(true)}>
              <Plus className="size-4" />
              Add activity
            </Button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <>
          <EditModuleDialog open={editOpen} onOpenChange={setEditOpen} courseId={courseId} module={module} />
          <NewActivityDialog
            open={newItemOpen}
            onOpenChange={setNewItemOpen}
            courseId={courseId}
            moduleId={module.id}
          />
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete module"
            description={
              <>
                Delete <span className="font-medium text-ink">{module.title}</span> and its{" "}
                {module.activities.length}{" "}
                {module.activities.length === 1 ? "activity" : "activities"}? This can&apos;t be
                undone.
              </>
            }
            confirmLabel="Delete module"
            pending={isPending}
            onConfirm={() => {
              startTransition(async () => {
                try {
                  await deleteModuleAction(courseId, module.id);
                  toast.success("Module deleted");
                  setConfirmOpen(false);
                } catch (err) {
                  toast.error("Something went wrong", { description: (err as Error).message });
                }
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline "Add module" composer.
// ---------------------------------------------------------------------------

export function ModuleComposer({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const next = title.trim();
    if (!next) return;
    startTransition(async () => {
      try {
        await createModuleAction(courseId, next);
        toast.success("Module added");
        setTitle("");
        setOpen(false);
      } catch (err) {
        toast.error("Something went wrong", { description: (err as Error).message });
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add module
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-card border border-line bg-surface p-2">
      <Input
        value={title}
        autoFocus
        placeholder="Module title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
      />
      <Button variant="secondary" onClick={submit} disabled={!title.trim() || isPending}>
        Add
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setTitle("");
          setOpen(false);
        }}
        disabled={isPending}
      >
        Cancel
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list: sortable modules + composer.
// ---------------------------------------------------------------------------

export function ModuleList({
  courseId,
  modules,
  canEdit,
}: {
  courseId: string;
  modules: ModuleTree[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const sensors = useDndSensors();
  const [reordering, startTransition] = useTransition();
  const [ordered, setOrdered] = useState<ModuleTree[]>(modules);
  const orderedRef = useRef(ordered);
  const dragSnapshot = useRef<ModuleTree[] | null>(null);
  const crossedModule = useRef(false);
  const [draggedActivity, setDraggedActivity] = useState<ActivityNode | null>(null);
  orderedRef.current = ordered;

  function updateOrdered(next: ModuleTree[]) {
    orderedRef.current = next;
    setOrdered(next);
  }
  const [serverModules, setServerModules] = useState<ModuleTree[]>(modules);

  // Re-sync local ordering when the server returns a new module set (e.g. after
  // a revalidated Server Action streams fresh props down).
  if (modules !== serverModules) {
    setServerModules(modules);
    setOrdered(modules);
  }

  function beforeTarget(
    modules: ModuleTree[],
    activityId: string,
    over: NonNullable<DragOverEvent["over"]>,
    event: DragMoveEvent | DragEndEvent,
  ): string | null {
    const destination = targetModule(modules, over.id);
    if (!destination || destination.id === over.id) return null;
    const others = destination.activities.filter((item) => item.id !== activityId);
    const index = others.findIndex((item) => item.id === over.id);
    if (index < 0) return null;
    const translated = event.active.rect.current.translated;
    const pointer =
      event.activatorEvent instanceof MouseEvent
        ? event.activatorEvent.clientY + event.delta.y
        : undefined;
    const y = pointer ?? (translated ? translated.top + translated.height / 2 : over.rect.top);
    const after = y > over.rect.top + over.rect.height / 2;
    return after ? (others[index + 1]?.id ?? null) : (others[index]?.id ?? null);
  }

  function handleDragStart({ active }: DragStartEvent) {
    dragSnapshot.current = orderedRef.current;
    crossedModule.current = false;
    const source = activityModule(orderedRef.current, active.id);
    setDraggedActivity(
      active.data.current?.kind === "activity"
        ? (source?.activities.find((item) => item.id === active.id) ?? null)
        : null,
    );
  }

  function handleDragMove(event: DragMoveEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.kind !== "activity") return;
    const current = orderedRef.current;
    const source = activityModule(current, active.id);
    const destination = targetModule(current, over.id);
    if (!source || !destination || active.id === over.id) return;
    if (source.id !== destination.id) crossedModule.current = true;
    if (source.id === destination.id && !crossedModule.current) return;
    const next = placeActivity(
      current,
      String(active.id),
      destination.id,
      beforeTarget(current, String(active.id), over, event),
    );
    if (next !== current) updateOrdered(next);
  }

  function handleDragCancel() {
    if (dragSnapshot.current) updateOrdered(dragSnapshot.current);
    dragSnapshot.current = null;
    crossedModule.current = false;
    setDraggedActivity(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const original = dragSnapshot.current ?? orderedRef.current;
    const current = orderedRef.current;
    dragSnapshot.current = null;
    crossedModule.current = false;
    setDraggedActivity(null);
    if (!over) {
      updateOrdered(original);
      return;
    }
    if (active.data.current?.kind === "module") {
      const oldIndex = original.findIndex((module) => module.id === active.id);
      const newIndex = original.findIndex((module) => module.id === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const next = arrayMove(original, oldIndex, newIndex);
      updateOrdered(next);
      startTransition(async () => {
        try {
          await reorderModulesAction(
            courseId,
            next.map((module) => module.id),
          );
        } catch (err) {
          updateOrdered(original);
          toast.error("Couldn't reorder modules", { description: (err as Error).message });
          router.refresh();
        }
      });
      return;
    }
    const source = activityModule(original, active.id);
    const currentModule = activityModule(current, active.id);
    const destination = targetModule(current, over.id);
    if (!source || !currentModule || !destination) {
      updateOrdered(original);
      return;
    }
    const next =
      active.id === over.id
        ? current
        : placeActivity(
            current,
            String(active.id),
            destination.id,
            beforeTarget(current, String(active.id), over, event),
          );
    const finalModule = activityModule(next, active.id);
    if (!finalModule) {
      updateOrdered(original);
      return;
    }
    const position = finalModule.activities.findIndex((item) => item.id === active.id);
    const initialPosition = source.activities.findIndex((item) => item.id === active.id);
    if (source.id === finalModule.id && initialPosition === position) {
      updateOrdered(original);
      return;
    }
    updateOrdered(next);
    startTransition(async () => {
      try {
        if (source.id === finalModule.id)
          await reorderActivitiesAction(
            courseId,
            source.id,
            finalModule.activities.map((item) => item.id),
          );
        else
          await moveActivityAction(
            courseId,
            source.id,
            String(active.id),
            finalModule.id,
            position,
          );
      } catch (err) {
        updateOrdered(original);
        toast.error(
          source.id === finalModule.id ? "Couldn't reorder activities" : "Couldn't move activity",
          { description: (err as Error).message },
        );
        router.refresh();
      }
    });
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink">No modules yet</p>
        <p className="max-w-sm text-sm text-ink-3 text-pretty">
          {canEdit
            ? "Start building this course by adding your first module."
            : "This course doesn't have any content yet."}
        </p>
        {canEdit ? <ModuleComposer courseId={courseId} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <DndContext
          id="course-modules"
          sensors={sensors}
          collisionDetection={curriculumCollisions}
          modifiers={DND_MODIFIERS}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={ordered.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {ordered.map((module, i) => (
                <SortableModule
                  key={module.id}
                  module={module}
                  index={i}
                  courseId={courseId}
                  canEdit={canEdit}
                  reordering={reordering}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
            {draggedActivity && <ActivityDragPreview item={draggedActivity} />}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map((module, i) => (
            <SortableModule
              key={module.id}
              module={module}
              index={i}
              courseId={courseId}
              canEdit={canEdit}
              reordering={reordering}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="pt-1">
          <ModuleComposer courseId={courseId} />
        </div>
      ) : null}
    </div>
  );
}
