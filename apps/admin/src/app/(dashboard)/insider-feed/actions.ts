"use server";

import { revalidatePath } from "next/cache";
import { Content, type JsonValueInput } from "@headless-lms/sdk";
import { authHeaders } from "@/lib/api/server-call";
import type { ActivitySettings } from "@/lib/api/types";

export async function saveFeedActivity(
  values: { title: string; category: string; difficulty: string },
  activityId?: string,
) {
  const headers = await authHeaders();
  let feed = await Content.getInsiderFeed(headers);
  if (!feed && !activityId) feed = await Content.ensureInsiderFeed(headers);
  if (!feed) throw new Error("Insider Feed not found");
  if (activityId) {
    const activity = (await Content.listActivities({ courseId: feed.courseId }, headers)).find(
      (item) => item.id === activityId && item.moduleId === feed.moduleId,
    );
    if (!activity) throw new Error("Activity not found");
    await Content.updateActivity(
      {
        courseId: feed.courseId,
        moduleId: feed.moduleId,
        activityId,
        settings: {
          ...((activity.settings ?? {}) as ActivitySettings),
          ...values,
        } as unknown as JsonValueInput,
      },
      headers,
    );
  } else {
    await Content.createActivity(
      {
        courseId: feed.courseId,
        moduleId: feed.moduleId,
        settings: { ...values, published: false },
      },
      headers,
    );
  }
  revalidatePath("/insider-feed");
}

export async function setFeedActivityPublished(activityId: string, published: boolean) {
  const headers = await authHeaders();
  const feed = await Content.getInsiderFeed(headers);
  if (!feed) throw new Error("Insider Feed not found");
  const activity = (await Content.listActivities({ courseId: feed.courseId }, headers)).find(
    (item) => item.id === activityId && item.moduleId === feed.moduleId,
  );
  if (!activity) throw new Error("Activity not found");
  await Content.updateActivity(
    {
      courseId: feed.courseId,
      moduleId: feed.moduleId,
      activityId,
      settings: {
        ...((activity.settings ?? {}) as ActivitySettings),
        published,
      } as unknown as JsonValueInput,
    },
    headers,
  );
  revalidatePath("/insider-feed");
}

export async function deleteFeedActivity(activityId: string) {
  const headers = await authHeaders();
  const feed = await Content.getInsiderFeed(headers);
  if (!feed) throw new Error("Insider Feed not found");
  await Content.deleteActivity(
    { courseId: feed.courseId, moduleId: feed.moduleId, activityId },
    headers,
  );
  revalidatePath("/insider-feed");
}

export async function changeInsiderCategoryAction(name: string, previous?: string) {
  const result = await Content.changeInsiderCategory(
    { name, ...(previous === undefined ? {} : { previous }) },
    await authHeaders(),
  );
  revalidatePath("/insider-feed");
  return result;
}

export async function deleteInsiderCategoryAction(name: string) {
  const result = await Content.deleteInsiderCategory({ name }, await authHeaders());
  revalidatePath("/insider-feed");
  return result;
}
