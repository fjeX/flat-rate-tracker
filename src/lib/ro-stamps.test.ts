import { describe, it, expect } from "vitest";
import { formatLoggedStamp } from "./ro-stamps";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-10-05T12:00:00Z");

describe("formatLoggedStamp", () => {
  it("shows only Logged when updatedAt is missing", () => {
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", undefined, TZ, NOW)).toBe("Logged Oct 2, 9:14 PM");
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", null, TZ, NOW)).toBe("Logged Oct 2, 9:14 PM");
  });
  it("hides Last edited within 60 seconds", () => {
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", "2026-10-03T04:14:45Z", TZ, NOW)).toBe(
      "Logged Oct 2, 9:14 PM",
    );
  });
  it("drops the date when edited the same day", () => {
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", "2026-10-03T04:40:00Z", TZ, NOW)).toBe(
      "Logged Oct 2, 9:14 PM · Last edited 9:40 PM",
    );
  });
  it("keeps the date on a different day", () => {
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", "2026-10-04T16:05:00Z", TZ, NOW)).toBe(
      "Logged Oct 2, 9:14 PM · Last edited Oct 4, 9:05 AM",
    );
  });
  it("same-day is judged in the tech's zone, not UTC", () => {
    // 9:14 PM and 11:30 PM Pacific are different UTC days.
    expect(formatLoggedStamp("2026-10-03T04:14:00Z", "2026-10-03T06:30:00Z", TZ, NOW)).toBe(
      "Logged Oct 2, 9:14 PM · Last edited 11:30 PM",
    );
  });
  it("shows the year on a date outside the current year", () => {
    expect(formatLoggedStamp("2025-10-03T04:14:00Z", undefined, TZ, NOW)).toBe(
      "Logged Oct 2, 2025, 9:14 PM",
    );
  });
  it("same month and day a year apart is not the same day", () => {
    expect(formatLoggedStamp("2025-10-03T04:14:00Z", "2026-10-03T04:40:00Z", TZ, NOW)).toBe(
      "Logged Oct 2, 2025, 9:14 PM · Last edited Oct 2, 9:40 PM",
    );
  });
  it("returns empty for garbage", () => {
    expect(formatLoggedStamp("", undefined, TZ, NOW)).toBe("");
  });
});
