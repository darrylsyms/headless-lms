import { describe, expect, it } from "vitest";
import type { ModuleTree } from "@/lib/api/types";
import { activityModule, placeActivity, targetModule } from "./curriculum-drag";

const fixture = () =>
  [
    {
      id: "m1",
      activities: [
        { id: "a", moduleId: "m1" },
        { id: "b", moduleId: "m1" },
      ],
    },
    {
      id: "m2",
      activities: [
        { id: "c", moduleId: "m2" },
        { id: "d", moduleId: "m2" },
      ],
    },
    { id: "m3", activities: [] },
  ] as unknown as ModuleTree[];
const ids = (modules: ModuleTree[], id: string) =>
  modules.find((module) => module.id === id)?.activities.map((item) => item.id);

describe("curriculum drag preview", () => {
  it("opens a space between destination items and can move back without duplication", () => {
    const original = fixture();
    const preview = placeActivity(original, "b", "m2", "d");
    expect(ids(preview, "m1")).toEqual(["a"]);
    expect(ids(preview, "m2")).toEqual(["c", "b", "d"]);
    expect(activityModule(preview, "b")?.id).toBe("m2");
    expect(activityModule(preview, "b")?.activities.find((item) => item.id === "b")?.moduleId).toBe(
      "m2",
    );
    expect(targetModule(preview, "d")?.id).toBe("m2");
    const back = placeActivity(preview, "b", "m1", "a");
    expect(ids(back, "m1")).toEqual(["b", "a"]);
    expect(ids(back, "m2")).toEqual(["c", "d"]);
    expect(ids(original, "m1")).toEqual(["a", "b"]);
  });
  it("supports empty modules, appending and reordering within a module", () => {
    const moved = placeActivity(fixture(), "a", "m3", null);
    expect(ids(moved, "m3")).toEqual(["a"]);
    const appended = placeActivity(moved, "a", "m2", null);
    expect(ids(appended, "m2")).toEqual(["c", "d", "a"]);
    const reordered = placeActivity(appended, "a", "m2", "c");
    expect(ids(reordered, "m2")).toEqual(["a", "c", "d"]);
    expect(placeActivity(reordered, "a", "m2", "c")).toBe(reordered);
  });
});
