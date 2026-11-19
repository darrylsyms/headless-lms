"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SettingsSection } from "@/components/forms/settings-section";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setCourseDescriptionsAction } from "../actions";

const schema = z.object({ shortDescription: z.string().trim().max(600, "Keep the description under 600 characters"), bodyDescription: z.string().max(20000, "Keep the description under 20,000 characters") });
type FormValues = z.infer<typeof schema>;

export function BodyDescriptionForm({ courseId, shortDescription, bodyDescription }: { courseId: string; shortDescription: string; bodyDescription?: string | null }) {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, dirtyFields, isDirty, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { shortDescription, bodyDescription: bodyDescription ?? "" } });
  async function onValid(values: FormValues) {
    try {
      const body = values.bodyDescription.trim();
      await setCourseDescriptionsAction(courseId, { ...(dirtyFields.shortDescription ? { short: values.shortDescription } : {}), ...(dirtyFields.bodyDescription ? { body: body || null } : {}) });
      reset({ shortDescription: values.shortDescription, bodyDescription: body });
      toast.success("Course descriptions saved");
      router.refresh();
    } catch (error) { toast.error("Couldn't save both descriptions", { description: `Some changes may have been saved. Try again. ${(error as Error).message}` }); }
  }
  return <form onSubmit={handleSubmit(onValid)} noValidate><SettingsSection title="Course descriptions" footer={<Button type="submit" variant="primary" disabled={!isDirty || isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>}>
    <Field id="course-short-description" label="Short description" hint="Shown in the course page header." error={errors.shortDescription?.message}><Textarea id="course-short-description" rows={4} {...register("shortDescription")} /></Field>
    <Field id="course-body-description" label="Body description" hint="Shown above the course content. Supports Markdown for headings, lists, links and emphasis." error={errors.bodyDescription?.message}><Textarea id="course-body-description" rows={12} {...register("bodyDescription")} /></Field>
  </SettingsSection></form>;
}
