import { describe, expect, it } from "vitest";
import { selectMedia } from "./bulk-selection";

describe("media bulk selection", () => {
  it("toggles individual items and selects a shift range in either direction", () => {
    const ids = ["a", "b", "c", "d"];
    expect(selectMedia([], ids, "b", null, false)).toEqual(["b"]);
    expect(selectMedia(["b"], ids, "b", "b", false)).toEqual([]);
    expect(selectMedia(["b"], ids, "d", "b", true)).toEqual(["b", "c", "d"]);
    expect(selectMedia(["d"], ids, "b", "d", true)).toEqual(["d", "b", "c"]);
  });
  it("treats an anchor on another page as an individual selection", () => {
    expect(selectMedia(["x"], ["a", "b"], "b", "x", true)).toEqual(["x", "b"]);
  });
});
