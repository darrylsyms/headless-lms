"use client";

import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { Trash2 } from "lucide-react";

import { minimumScheduleTime } from "@/lib/publication-date";
import { DatePicker } from "@/components/forms/date-picker";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { SettingRow } from "@/components/forms/settings-section";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { ActivityArtwork } from "./activity-artwork";

import type { ActivityFormValues } from "./activity-builder";

const OVERRIDE_LABELS: Record<ActivityFormValues["comments"], string> = {
  inherit: "Inherit from course",
  always: "Always allow",
  never: "Never allow",
};

export function ActivitySettingsPanel({
  form,
  artwork,
  previouslyPublished,
  hasPublicationDate,
  courseTranscriptDownloads,
  courseCommentsEnabled,
  onDelete,
}: {
  form: UseFormReturn<ActivityFormValues>;
  artwork: {
    courseId: string;
    moduleId: string;
    activityId: string;
    assetId: string | null;
    url: string | null;
  };
  previouslyPublished: boolean;
  hasPublicationDate: boolean;
  courseTranscriptDownloads: boolean;
  courseCommentsEnabled: boolean;
  onDelete: () => void;
}) {
  const {
    control,
    register,
    getValues,
    setValue,
    formState: { errors },
  } = form;
  const publishedDay = useWatch({ control, name: "publishedAt" });
  const scheduleDay = useWatch({ control, name: "scheduleDay" });
  const published = useWatch({ control, name: "published" });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-1 pb-6">
        <SettingRow
          id="activity-published"
          label="Published"
          hint="Draft activities stay hidden from enrolled students."
        >
          <Controller
            control={control}
            name="published"
            render={({ field }) => (
              <Switch
                id="activity-published"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingRow>

        {!published && (
          <>
            <Field
              id="activity-schedule-day"
              label="Scheduled publish date"
              error={errors.scheduleDay?.message}
              hint={previouslyPublished ? "Save as draft before scheduling." : undefined}
            >
              <Controller
                control={control}
                name="scheduleDay"
                render={({ field }) => (
                  <DatePicker
                    id="activity-schedule-day"
                    label="Scheduled publish date"
                    value={field.value}
                    direction="future"
                    onClear={() => {
                      setValue("scheduleDay", "", { shouldDirty: true });
                      setValue("scheduleTime", "", { shouldDirty: true });
                    }}
                    disabled={previouslyPublished}
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
              id="activity-schedule-time"
              label="Scheduled publish time (UTC)"
              error={errors.scheduleTime?.message}
            >
              <Input
                id="activity-schedule-time"
                type="time"
                min={minimumScheduleTime(scheduleDay)}
                disabled={previouslyPublished || !scheduleDay}
                {...register("scheduleTime")}
              />
            </Field>
          </>
        )}
        {previouslyPublished && published && (
          <>
            <Field
              id="activity-published-at"
              label="Publish date"
              error={errors.publishedAt?.message}
              hint={
                !hasPublicationDate ? "The original publication date is unavailable." : undefined
              }
            >
              <Controller
                control={control}
                name="publishedAt"
                render={({ field }) => (
                  <DatePicker
                    label="Publish date"
                    id="activity-published-at"
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      if (!getValues("publishedTime"))
                        setValue("publishedTime", "00:00", { shouldDirty: true });
                    }}
                  />
                )}
              />
            </Field>

            <Field
              id="activity-published-time"
              label="Publish time (UTC)"
              error={errors.publishedTime?.message}
            >
              <Input
                id="activity-published-time"
                type="time"
                disabled={!publishedDay}
                {...register("publishedTime")}
              />
            </Field>
          </>
        )}

        <ActivityArtwork {...artwork} />

        <SettingRow id="activity-completion" label="Mark complete" hint="Students mark activities complete themselves.">
          <Input id="activity-completion" value="Manual" readOnly />
        </SettingRow>

        <Field
          id="activity-transcripts"
          label="Transcript downloads"
          hint={`The course currently ${courseTranscriptDownloads ? "allows" : "blocks"} transcript downloads.`}
        >
          <Controller
            control={control}
            name="transcriptDownloads"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="activity-transcripts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OVERRIDE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field
          id="activity-comments"
          label="Comments"
          hint={`The course currently has comments ${courseCommentsEnabled ? "on" : "off"}. Turning them off here overrides the course; it cannot turn them back on.`}
        >
          <Controller
            control={control}
            name="comments"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="activity-comments">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OVERRIDE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 />
          Delete activity
        </Button>
      </div>
    </div>
  );
}
