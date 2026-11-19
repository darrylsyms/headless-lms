"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SettingsSection } from "@/components/forms/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCourseSettingsAction } from "../../actions";

const schema = z.object({ trailerUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2048)]) });
type FormValues = z.infer<typeof schema>;

export function TrailerForm({ courseId, trailerUrl }: { courseId: string; trailerUrl?: string | null }) {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { trailerUrl: trailerUrl ?? "" } });
  async function onValid(values: FormValues) {
    try {
      const settings = await updateCourseSettingsAction(courseId, { trailerUrl: values.trailerUrl || null });
      reset({ trailerUrl: settings.trailerUrl ?? "" });
      toast.success("Trailer saved");
      router.refresh();
    } catch (error) { toast.error("Couldn't save trailer", { description: (error as Error).message }); }
  }
  return <form onSubmit={handleSubmit(onValid)} noValidate><SettingsSection title="Course trailer" description="Show a playable trailer on the course page." footer={<Button type="submit" variant="primary" disabled={!isDirty || isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>}>
    <Field label="Video URL" id="course-trailer-url" hint="Use a Vimeo, YouTube or direct HTTPS video URL." error={errors.trailerUrl?.message}><Input id="course-trailer-url" type="url" placeholder="https://" {...register("trailerUrl")} /></Field>
  </SettingsSection></form>;
}
