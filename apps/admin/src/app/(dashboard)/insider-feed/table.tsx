"use client";

import { Suspense, useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { FormDialog } from "@/components/forms/form-dialog";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "../courses/_components/category-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/data-table";
import { ColumnHeader } from "@/components/data-table/column-header";
import { useDataTable } from "@/components/data-table/use-data-table";
import { CourseStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { RowActions } from "@/components/data-table/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { relativeTime } from "@/lib/format";
import type { Activity, ActivitySettings } from "@/lib/api/types";
import { FeedTabs } from "./tabs";
import { selectFeedRows, type FeedRow } from "./select-feed-rows";
import { deleteFeedActivity, saveFeedActivity, setFeedActivityPublished } from "./actions";

const schema = z.object({
  title: z.string().trim().min(1, "A title is required").max(120),
  category: z.string().trim().max(100),
  difficulty: z.enum(["all_levels", "beginner", "intermediate", "advanced", "expert"]),
});
type Values = z.infer<typeof schema>;
const levels = [
  ["all_levels", "All Levels"],
  ["beginner", "Beginner"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
  ["expert", "Expert"],
] as const;

function EditActivity({
  activity,
  onClose,
  categories,
}: {
  activity?: Activity;
  onClose: () => void;
  categories: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const settings = (activity?.settings ?? {}) as ActivitySettings;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: settings.title ?? "",
      category: settings.category ?? "",
      difficulty: settings.difficulty ?? "all_levels",
    },
  });
  function save(values: Values) {
    startTransition(async () => {
      try {
        await saveFeedActivity(values, activity?.id);
        toast.success(activity ? "Activity updated" : "Activity added");
        onClose();
        router.refresh();
      } catch (error) {
        toast.error("Couldn't save activity", { description: (error as Error).message });
      }
    });
  }
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={activity ? "Edit activity" : "New activity"}
      formId="feed-activity"
      pending={pending}
      submitLabel={activity ? "Save" : "Add activity"}
    >
      <form
        id="feed-activity"
        onSubmit={handleSubmit(save)}
        className="flex flex-col gap-5"
        noValidate
      >
        <Field id="feed-title" label="Name" required error={errors.title?.message}>
          <Input id="feed-title" autoFocus {...register("title")} />
        </Field>
        <Field id="feed-category" label="Category" error={errors.category?.message}>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <CategoryPicker
                id="feed-category"
                scope="insider"
                categories={categories}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </Field>
        <Field id="feed-difficulty" label="Difficulty" error={errors.difficulty?.message}>
          <Controller
            control={control}
            name="difficulty"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="feed-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levels.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

function FeedTableInner({
  feed,
  activities,
  canEdit,
  canModerate,
  categories,
}: {
  feed: { courseId: string; moduleId: string } | null;
  activities: Activity[];
  canEdit: boolean;
  canModerate: boolean;
  categories: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<void>, message: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(message);
        setDeleting(null);
        router.refresh();
      } catch (error) {
        toast.error("Couldn't update activity", { description: (error as Error).message });
      }
    });
  }
  const table = useDataTable({ pageSize: 20, initialSort: [{ id: "updatedAt", desc: true }] });
  const { rows, total } = useMemo(
    () => selectFeedRows(activities, table.params),
    [activities, table.params],
  );
  const columns: ColumnDef<FeedRow, unknown>[] = [
    {
      accessorKey: "title",
      enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <Link
          className="font-medium text-ink underline-offset-4 hover:text-brand [td:hover_&]:underline"
          onClick={(event) => event.stopPropagation()}
          href={`/courses/${feed?.courseId}/content/${row.original.activity.id}?feed=1`}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: "category",
      header: ({ column }) => <ColumnHeader column={column} title="Category" />,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <ColumnHeader column={column} title="Status" />,
      cell: ({ row }) =>
        row.original.status === "scheduled" ? (
          <Badge variant="warning" className="px-2.5">
            Scheduled
          </Badge>
        ) : (
          <CourseStatusBadge status={row.original.status} />
        ),
    },
    {
      accessorKey: "updatedAt",
      header: ({ column }) => <ColumnHeader column={column} title="Updated" align="right" />,
      meta: { align: "right" },
      cell: ({ row }) => <span className="text-ink-3">{relativeTime(row.original.updatedAt)}</span>,
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const { activity, title, status } = row.original;
        const published = status === "published";
        const url = `/courses/${feed?.courseId}/content/${activity.id}?feed=1`;
        return canEdit ? (
          <div className="flex justify-end">
            <RowActions label={`Actions for ${title}`}>
              <DropdownMenuItem asChild>
                <Link href={url}>Edit content</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditing(activity)}>Edit details</DropdownMenuItem>
              <DropdownMenuItem
                disabled={pending}
                onClick={() =>
                  run(
                    () => setFeedActivityPublished(activity.id, !published),
                    published ? "Moved to draft" : "Activity published",
                  )
                }
              >
                {published ? "Unpublish" : "Publish"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onClick={() => setDeleting(activity)}>
                Delete activity
              </DropdownMenuItem>
            </RowActions>
          </div>
        ) : null;
      },
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Insider Feed"
        className="min-h-9"
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New activity
            </Button>
          ) : (
            <span aria-hidden="true" className="block h-9" />
          )
        }
      />
      <FeedTabs active="activities" canModerate={canModerate} />
      <DataTable<FeedRow>
        columns={columns}
        onRowClick={(row) => router.push(`/courses/${feed?.courseId}/content/${row.activity.id}?feed=1`)}
        rows={rows}
        total={total}
        state={table}
        isLoading={false}
        isError={false}
        isFetching={pending}
        refetch={() => router.refresh()}
        getRowId={(row) => row.activity.id}
        searchPlaceholder="Search activities…"
        facets={[
          {
            columnId: "status",
            title: "Status",
            options: [
              { label: "Draft", value: "draft" },
              { label: "Scheduled", value: "scheduled" },
              { label: "Published", value: "published" },
            ],
          },
          {
            columnId: "category",
            title: "Category",
            options: categories.map((category) => ({ label: category, value: category })),
          },
        ]}
        emptyTitle="No activities yet"
        emptyDescription={
          canEdit ? "Get started by creating your first activity." : "There are no activities yet."
        }
        emptyAction={
          canEdit ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New activity
            </Button>
          ) : undefined
        }
      />
      {editing && (
        <EditActivity
          categories={categories}
          activity={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete activity"
        description="This will permanently delete this activity and its comments."
        confirmLabel="Delete activity"
        pending={pending}
        onConfirm={() => deleting && run(() => deleteFeedActivity(deleting.id), "Activity deleted")}
      />
    </div>
  );
}

export function FeedTable(props: Parameters<typeof FeedTableInner>[0]) {
  return (
    <Suspense>
      <FeedTableInner {...props} />
    </Suspense>
  );
}
