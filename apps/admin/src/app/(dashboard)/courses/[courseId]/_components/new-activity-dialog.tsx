"use client";

import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { FormDialog } from "@/components/forms/form-dialog";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Controller } from "react-hook-form";
import type { ActivitySettings } from "@/lib/api/types";

import { saveActivityAction } from "../actions";

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give this activity a title")
    .max(120, "Keep the title under 120 characters"),
  parentActivityId: z.string(),
});

type FormValues = z.infer<typeof schema>;

const FORM_ID = "new-activity-form";

/**
 * Create-only. A title is all it takes to get an activity into the module —
 * everything else (publishing, completion rule, transcripts) is edited on the
 * activity's settings tab, so this stays a one-field modal.
 */
export function NewActivityDialog({
  open,
  onOpenChange,
  courseId,
  moduleId,
  topicParents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  moduleId: string;
  topicParents?: { id: string; title: string }[];
}) {
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", parentActivityId: "" },
  });

  // Clear the previous draft whenever the modal reopens.
  useEffect(() => {
    if (open) reset({ title: "", parentActivityId: topicParents?.at(-1)?.id ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onValid(values: FormValues) {
    if (topicParents && !values.parentActivityId) { setError("parentActivityId", { message: "Choose an activity" }); return; }
    const settings: ActivitySettings = { title: values.title, published: false };

    startTransition(async () => {
      try {
        await saveActivityAction(courseId, moduleId, { settings, ...(topicParents ? { parentActivityId: values.parentActivityId } : {}) });
      } catch (err) {
        toast.error("Something went wrong", { description: (err as Error).message });
        return;
      }
      toast.success(topicParents ? "Topic added" : "Activity added");
      onOpenChange(false);
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={topicParents ? "New topic" : "New activity"}
      description={topicParents ? "Add a topic to an activity." : "Add content to this module. You can reorder it afterwards."}
      formId={FORM_ID}
      submitLabel={topicParents ? "Add topic" : "Add activity"}
      pending={isPending}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onValid)} noValidate className="flex flex-col gap-5">
        {topicParents && <Field id="topic-parent" label="Activity" required error={errors.parentActivityId?.message}><Controller control={control} name="parentActivityId" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="topic-parent"><SelectValue placeholder="Choose an activity" /></SelectTrigger><SelectContent>{topicParents.map(parent => <SelectItem key={parent.id} value={parent.id}>{parent.title}</SelectItem>)}</SelectContent></Select>} /></Field>}
        <Field id="title" label="Title" required error={errors.title?.message}>
          <Input id="title" placeholder="Welcome & overview" autoFocus {...register("title")} />
        </Field>
      </form>
    </FormDialog>
  );
}
