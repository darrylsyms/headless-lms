"use client";

import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FormDialog } from "@/components/forms/form-dialog";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ModuleTree } from "@/lib/api/types";
import { updateModuleAction } from "../actions";

const schema = z.object({
  title: z.string().trim().min(1, "Give this module a title"),
  description: z.string().trim().max(1000, "Keep the description under 1000 characters"),
});
type FormValues = z.infer<typeof schema>;

export function EditModuleDialog({ open, onOpenChange, courseId, module }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  module: ModuleTree;
}) {
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: module.title, description: module.description ?? "" },
  });
  useEffect(() => {
    if (open) reset({ title: module.title, description: module.description ?? "" });
  }, [open, reset, module.title, module.description]);

  function save(values: FormValues) {
    startTransition(async () => {
      try {
        await updateModuleAction(courseId, module.id, values.title, values.description || null);
        toast.success("Module updated");
        onOpenChange(false);
      } catch (error) {
        toast.error("Couldn't update module", { description: (error as Error).message });
      }
    });
  }

  const formId = `edit-module-${module.id}`;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Edit module" formId={formId} pending={pending}>
      <form id={formId} onSubmit={handleSubmit(save)} className="flex flex-col gap-5" noValidate>
        <Field id={`${formId}-title`} label="Title" required error={errors.title?.message}>
          <Input id={`${formId}-title`} {...register("title")} />
        </Field>
        <Field id={`${formId}-description`} label="Description" error={errors.description?.message}>
          <Textarea id={`${formId}-description`} {...register("description")} />
        </Field>
      </form>
    </FormDialog>
  );
}
