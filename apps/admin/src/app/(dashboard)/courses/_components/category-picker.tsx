"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SearchableSelect } from "@/components/forms/searchable-select";
import { Input } from "@/components/ui/input";
import { changeCourseCategoryAction, deleteCourseCategoryAction } from "../actions";
import { changeInsiderCategoryAction, deleteInsiderCategoryAction } from "../../insider-feed/actions";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a category name").max(100, "Keep it under 100 characters"),
});
type Values = z.infer<typeof schema>;

export function CategoryPicker({
  categories,
  value,
  onChange,
  id = "category",
  scope = "course",
}: {
  categories: string[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  scope?: "course" | "insider";
}) {
  const router = useRouter();
  const formId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "" } });

  async function create(name: string) {
    try {
      await (scope === "insider" ? changeInsiderCategoryAction(name) : changeCourseCategoryAction(name));
      toast.success("Category created");
      router.refresh();
      return name;
    } catch (error) {
      toast.error("Couldn't create category", { description: (error as Error).message });
      throw error;
    }
  }

  function rename({ name }: Values) {
    if (!editing) return;
    startTransition(async () => {
      try {
        await (scope === "insider" ? changeInsiderCategoryAction(name, editing) : changeCourseCategoryAction(name, editing));
        if (value === editing) onChange(name);
        setEditing(null);
        toast.success("Category renamed");
        router.refresh();
      } catch (error) {
        toast.error("Couldn't rename category", { description: (error as Error).message });
      }
    });
  }

  function remove() {
    if (!editing) return;
    startTransition(async () => {
      try {
        await (scope === "insider" ? deleteInsiderCategoryAction(editing) : deleteCourseCategoryAction(editing));
        if (value === editing) onChange("");
        setConfirmDelete(false);
        setEditing(null);
        toast.success("Category deleted");
        router.refresh();
      } catch (error) {
        toast.error("Couldn't delete category", { description: (error as Error).message });
      }
    });
  }

  return (
    <>
      <SearchableSelect
        id={id}
        value={value}
        options={[
          { value: "", label: "Uncategorised" },
          ...categories.map((category) => ({ value: category, label: category })),
        ]}
        onChange={onChange}
        placeholder="Uncategorised"
        emptyLabel="No categories found"
        createLabel={(name) => `Create category “${name}”`}
        onCreate={create}
        onEdit={
          value
            ? (option) => {
                reset({ name: option.label });
                setEditing(option.value);
              }
            : undefined
        }
        editLabel={(option) => `Edit “${option.label}”`}
        maxLength={100}
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="Edit Category"
        description={scope === "insider" ? "The new name will appear on every activity in this category." : "The new name will appear on every course in this category."}
        formId={formId}
        submitLabel="Save name"
        pending={pending}
        footerStart={
          <Button variant="destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
            Delete category
          </Button>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.stopPropagation();
            void handleSubmit(rename)(event);
          }}
          className="flex flex-col gap-5"
        >
          <Field id={`${formId}-name`} label="Category name" required error={errors.name?.message}>
            <Input id={`${formId}-name`} autoFocus maxLength={100} {...register("name")} />
          </Field>
        </form>
      </FormDialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete category?"
        description={<>Delete “{editing}”? {scope === "insider" ? "Activities" : "Courses"} in this category will become uncategorised.</>}
        confirmLabel="Delete category"
        pending={pending}
        onConfirm={remove}
      />
    </>
  );
}
