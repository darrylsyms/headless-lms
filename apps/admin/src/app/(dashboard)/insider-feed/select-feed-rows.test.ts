import { describe, expect, it } from "vitest";
import type { Activity } from "@/lib/api/types";
import { selectFeedRows } from "./select-feed-rows";

function activity(id: string, title: string, category: string, published: boolean, scheduledAt: string | null = null): Activity {
  return { id, orgId: "org", courseId: "course", moduleId: "module", parentActivityId: null, seq: 0, settings: { title, category, published }, publishedAt: null, scheduledAt, createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-01-0${id}T00:00:00Z`, assetUrls: {} };
}
const items = [activity("1", "Zebra", "Songs", true), activity("2", "Alpha", "Theory", false), activity("3", "Beta", "Songs", false, "2027-01-01T00:00:00Z")];

describe("selectFeedRows", () => {
  it("sorts before paginating and reports the filtered total", () => {
    const result = selectFeedRows(items, { page: 2, pageSize: 1, sort: [{ id: "title", desc: false }] });
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.title)).toEqual(["Beta"]);
  });
  it("combines search, status and category filters", () => {
    const result = selectFeedRows(items, { page: 1, pageSize: 20, search: "song", filters: { status: ["scheduled"], category: ["Songs"] } });
    expect(result.rows.map((row) => row.title)).toEqual(["Beta"]);
    expect(result.total).toBe(1);
  });
});
