import { Content, type ListMemberCoursesResponse } from "@headless-lms/sdk";
import { statusOf } from "./shared";

type RequestOptions = { headers: { cookie: string } };

export async function listVisibleCourses(
  options?: RequestOptions,
): Promise<ListMemberCoursesResponse> {
  const enrolled = await Content.listMemberCourses(options);
  const readable: ListMemberCoursesResponse = [];
  let page = 1;
  try {
    while (true) {
      const result = await Content.listCourses(
        { page, pageSize: 100, status: "published" },
        options,
      );
      readable.push(...result.rows);
      if (page * result.pageSize >= result.total || result.rows.length === 0) break;
      page++;
    }
  } catch (error) {
    if (statusOf(error) !== 403) throw error;
  }
  return [...new Map([...enrolled, ...readable].map((course) => [course.id, course])).values()];
}
