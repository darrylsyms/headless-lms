import { describe, expect, it } from "vitest";
import { containsVideoBlock } from "./activity-video";

describe("containsVideoBlock", () => {
  it("finds video blocks after text and inside nested content", () => {
    expect(containsVideoBlock([{ type: "p", children: [{ text: "Introduction" }] }, { type: "video", url: "https://vimeo.com/123" }])).toBe(true);
    expect(containsVideoBlock([{ type: "column", children: [{ type: "video" }] }])).toBe(true);
  });

  it("treats text, empty and malformed content as written", () => {
    expect(containsVideoBlock([{ type: "p", children: [{ text: "A video lesson" }] }])).toBe(false);
    expect(containsVideoBlock(null)).toBe(false);
    expect(containsVideoBlock({ type: "p", children: "video" })).toBe(false);
  });
});
