import { beforeEach, describe, expect, it, vi } from "vitest";
import { Content } from "@headless-lms/sdk";
import { ApiError } from "./shared";
import { listVisibleCourses } from "./visible-courses";

vi.mock("@headless-lms/sdk", () => ({
  Content: { listMemberCourses: vi.fn(), listCourses: vi.fn() },
}));

const course = (id: string) => ({ id, category: "", status: "published" }) as never;

describe("student library visibility", () => {
  beforeEach(() => vi.resetAllMocks());

  it("includes and deduplicates permitted staff courses across pages", async () => {
    vi.mocked(Content.listMemberCourses).mockResolvedValue([course("a")]);
    vi.mocked(Content.listCourses)
      .mockResolvedValueOnce({ rows: [course("a"), course("b")], page: 1, pageSize: 2, total: 3 })
      .mockResolvedValueOnce({ rows: [course("c")], page: 2, pageSize: 2, total: 3 });
    const result = await listVisibleCourses();
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(Content.listCourses).toHaveBeenCalledWith(
      { page: 1, pageSize: 100, status: "published" },
      undefined,
    );
  });

  it("shows only enrolled courses when staff access is forbidden", async () => {
    vi.mocked(Content.listMemberCourses).mockResolvedValue([course("a")]);
    vi.mocked(Content.listCourses).mockRejectedValue(new ApiError(403, "Forbidden"));
    expect((await listVisibleCourses()).map((item) => item.id)).toEqual(["a"]);
  });

  it("does not hide unexpected API failures", async () => {
    vi.mocked(Content.listMemberCourses).mockResolvedValue([]);
    vi.mocked(Content.listCourses).mockRejectedValue(new ApiError(500, "Unavailable"));
    await expect(listVisibleCourses()).rejects.toThrow("Unavailable");
  });
});
