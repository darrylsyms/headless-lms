import { describe, expect, it } from "vitest";
import { minimumScheduleTime, publicationDay, publicationInstant, publicationTime } from "./publication-date";

describe("publication date and time", () => {
  it("limits same-day scheduling to a future minute", () => {
    const now = new Date("2026-11-12T15:30:45.000Z");
    expect(minimumScheduleTime("2026-11-12", now)).toBe("15:31");
    expect(minimumScheduleTime("2026-11-13", now)).toBeUndefined();
  });

  it("reads UTC date and time from an existing timestamp", () => {
    expect(publicationDay("2026-11-12T23:45:12.345Z")).toBe("2026-11-12");
    expect(publicationTime("2026-11-12T23:45:12.345Z")).toBe("23:45");
  });

  it("preserves seconds when changing only the date", () => {
    expect(publicationInstant("2026-11-05", "23:45", "2026-11-12T23:45:12.345Z")).toBe(
      "2026-11-05T23:45:12.345Z",
    );
  });

  it("uses the chosen time and resets seconds when editing the time", () => {
    expect(publicationInstant("2026-11-05", "09:30", "2026-11-12T23:45:12.345Z")).toBe(
      "2026-11-05T09:30:00.000Z",
    );
    expect(publicationInstant("2026-11-05", "00:00", null)).toBe("2026-11-05T00:00:00.000Z");
  });
});
