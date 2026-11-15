"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { DatePicker } from "@/components/forms/date-picker";
import { Field } from "@/components/forms/field";
import { SettingRow, SettingsSection } from "@/components/forms/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CategoryPicker } from "../../../_components/category-picker";
import {
  minimumScheduleTime,
  publicationDay,
  publicationInstant,
  publicationIsFuture,
  publicationTime,
} from "@/lib/publication-date";
import type { Course } from "@/lib/api/types";

import { setSongLibraryAction } from "../actions";
import { updateCourseDetailsAction } from "../../actions";

const schema = z.object({
  title: z.string().trim().min(1, "A title is required").max(120, "Keep it under 120 characters"),
  category: z.string(),
  difficulty: z.enum(["all_levels", "beginner", "intermediate", "advanced", "expert"]),
  publishedAt: z.string(),
  publishedTime: z.string(),
  scheduleDay: z.string(),
  scheduleTime: z.string(),
  description: z.string().trim().max(600, "Keep the description under 600 characters"),
});

type FormValues = z.infer<typeof schema>;

/** Settings → Basics: the course's title, category, and description. */
export function BasicsForm({ course, categories }: { course: Course; categories: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [songLibrary, setSongLibrary] = useState(course.settings.songLibrary ?? false);
  const [songPending, startSongTransition] = useTransition();

  function updateSongLibrary(checked: boolean) {
    const previous = songLibrary;
    setSongLibrary(checked);
    startSongTransition(async () => {
      try {
        await setSongLibraryAction(course.id, checked);
      } catch (error) {
        setSongLibrary(previous);
        toast.error("Could not save", { description: (error as Error).message });
      }
    });
  }
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    setError,
    control,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: course.title,
      category: course.category,
      difficulty: course.difficulty,
      publishedAt: publicationDay(course.publishedAt),
      publishedTime: publicationTime(course.publishedAt),
      scheduleDay: publicationDay(course.scheduledAt),
      scheduleTime: publicationTime(course.scheduledAt),
      description: course.description,
    },
  });

  // Re-sync when the server sends a fresh course (after a save revalidates).
  useEffect(() => {
    reset({
      title: course.title,
      category: course.category,
      difficulty: course.difficulty,
      publishedAt: publicationDay(course.publishedAt),
      publishedTime: publicationTime(course.publishedAt),
      scheduleDay: publicationDay(course.scheduledAt),
      scheduleTime: publicationTime(course.scheduledAt),
      description: course.description,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    course.id,
    course.title,
    course.category,
    course.difficulty,
    course.publishedAt,
    course.scheduledAt,
    course.description,
  ]);

  const category = useWatch({ control, name: "category" });
  const difficulty = useWatch({ control, name: "difficulty" });
  const publishedDay = useWatch({ control, name: "publishedAt" });
  const scheduleDay = useWatch({ control, name: "scheduleDay" });

  function onValid(values: FormValues) {
    const { publishedAt, publishedTime, scheduleDay, scheduleTime, ...details } = values;
    let scheduledAt: string | null | undefined;
    if (
      course.status === "draft" &&
      (scheduleDay !== publicationDay(course.scheduledAt) ||
        scheduleTime !== publicationTime(course.scheduledAt))
    ) {
      if (!scheduleDay && !scheduleTime) scheduledAt = null;
      else if (!scheduleDay || !scheduleTime) {
        setError(!scheduleDay ? "scheduleDay" : "scheduleTime", {
          message: "Choose both a date and time.",
        });
        return;
      } else {
        scheduledAt = publicationInstant(scheduleDay, scheduleTime, course.scheduledAt);
        if (!publicationIsFuture(scheduledAt)) {
          setError("scheduleTime", { message: "Choose a future date and time." });
          return;
        }
      }
    }
    const changed =
      publishedAt !== publicationDay(course.publishedAt) ||
      publishedTime !== publicationTime(course.publishedAt);
    let instant: string | undefined;
    if (course.status === "published" && changed) {
      if (!publishedAt || !publishedTime) {
        setError(!publishedAt ? "publishedAt" : "publishedTime", {
          message: "Choose both a date and time.",
        });
        return;
      }
      instant = publicationInstant(publishedAt, publishedTime, course.publishedAt);
      if (publicationIsFuture(instant)) {
        setError("publishedTime", { message: "Publish date and time cannot be in the future." });
        return;
      }
    }
    startTransition(async () => {
      try {
        await updateCourseDetailsAction(course.id, {
          ...details,
          ...(instant ? { publishedAt: instant } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        });
        toast.success("Changes saved");
        router.refresh();
      } catch (err) {
        toast.error("Couldn't Save", { description: (err as Error).message });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <SettingsSection
        title="Details"
        description="How this course is titled and categorised across the product."
        footer={
          <Button type="submit" variant="primary" disabled={isPending || !isDirty}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        }
      >
        <Field id="title" label="Title" required error={errors.title?.message}>
          <Input id="title" {...register("title")} />
        </Field>
        <Field id="category" label="Category" error={errors.category?.message}>
          <CategoryPicker
            categories={categories}
            value={category}
            onChange={(v) => setValue("category", v, { shouldValidate: true, shouldDirty: true })}
          />
        </Field>
        <SettingRow
          id="song-library"
          label="Add to Song Library"
          hint="Show this course in the Song Library instead of the Course Library."
        >
          <Switch id="song-library" checked={songLibrary} disabled={songPending} onCheckedChange={updateSongLibrary} />
        </SettingRow>
        <Field id="difficulty" label="Difficulty" error={errors.difficulty?.message}>
          <Select
            value={difficulty}
            onValueChange={(v) =>
              setValue("difficulty", v as FormValues["difficulty"], {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger id="difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_levels">All Levels</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
              <SelectItem value="expert">Expert</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {course.status === "draft" && (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field
                id="schedule-day"
                label="Scheduled publish date"
                error={errors.scheduleDay?.message}
              >
                <Controller
                  control={control}
                  name="scheduleDay"
                  render={({ field }) => (
                    <DatePicker
                      id="schedule-day"
                      label="Scheduled publish date"
                      value={field.value}
                      direction="future"
                      onClear={() => {
                        setValue("scheduleDay", "", { shouldDirty: true });
                        setValue("scheduleTime", "", { shouldDirty: true });
                      }}
                      onChange={(v) => {
                        field.onChange(v);
                        if (!getValues("scheduleTime"))
                          setValue("scheduleTime", minimumScheduleTime(v) ?? "00:00", {
                            shouldDirty: true,
                          });
                      }}
                    />
                  )}
                />
              </Field>
              <Field
                id="schedule-time"
                label="Scheduled publish time (UTC)"
                error={errors.scheduleTime?.message}
              >
                <Input
                  id="schedule-time"
                  type="time"
                  min={minimumScheduleTime(scheduleDay)}
                  disabled={!scheduleDay}
                  {...register("scheduleTime")}
                />
              </Field>
            </div>
          </>
        )}
        {course.status === "published" && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              id="published-at"
              label="Publish date"
              error={errors.publishedAt?.message}
              hint={
                !course.publishedAt ? "The original publication date is unavailable." : undefined
              }
            >
              <Controller
                control={control}
                name="publishedAt"
                render={({ field }) => (
                  <DatePicker
                    label="Publish date"
                    id="published-at"
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      if (!course.publishedAt && !getValues("publishedTime"))
                        setValue("publishedTime", "00:00", { shouldDirty: true });
                    }}
                  />
                )}
              />
            </Field>
            <Field
              id="published-time"
              label="Publish time (UTC)"
              error={errors.publishedTime?.message}
            >
              <Input
                id="published-time"
                type="time"
                disabled={!publishedDay}
                {...register("publishedTime")}
              />
            </Field>
          </div>
        )}
        <Field
          id="description"
          label="Description"
          hint="A short summary shown on the course card."
          error={errors.description?.message}
        >
          <Textarea id="description" rows={5} {...register("description")} />
        </Field>
      </SettingsSection>
    </form>
  );
}
