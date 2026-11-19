import { describe, expect, it } from "vitest";
import type { ModuleTree } from "@/lib/api/types";
import { activityModule, placeActivity, placeTopic, targetModule } from "./curriculum-drag";

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
  it("moves an activity and its topics together", () => {
    const modules = fixture();
    modules[0].activities.splice(1, 0, { id: "topic", moduleId: "m1", parentActivityId: "a" } as ModuleTree["activities"][number]);
    const moved = placeActivity(modules, "a", "m2", "d");
    expect(ids(moved, "m1")).toEqual(["b"]);
    expect(ids(moved, "m2")).toEqual(["c", "a", "topic", "d"]);
    expect(moved[1].activities.find(item => item.id === "topic")?.moduleId).toBe("m2");
    expect(placeActivity(modules, "topic", "m2", null)).toBe(modules);
  });
  it("moves a topic to another activity or module without moving its siblings", () => {
    const modules = fixture();
    modules[0].activities.splice(1, 0, { id: "t1", moduleId: "m1", parentActivityId: "a" } as ModuleTree["activities"][number], { id: "t2", moduleId: "m1", parentActivityId: "a" } as ModuleTree["activities"][number]);
    const sameModule = placeTopic(modules, "t1", "b", null);
    expect(ids(sameModule, "m1")).toEqual(["a", "t2", "b", "t1"]);
    expect(sameModule[0].activities.find(item => item.id === "t1")?.parentActivityId).toBe("b");
    const differentModule = placeTopic(sameModule, "t1", "c", null);
    expect(ids(differentModule, "m2")).toEqual(["c", "t1", "d"]);
    expect(differentModule[1].activities.find(item => item.id === "t1")).toMatchObject({ moduleId: "m2", parentActivityId: "c" });
  });
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
