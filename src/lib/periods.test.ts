import { describe, it, expect } from "vitest";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  getPeriodForDate,
  getRangeForPeriodKey,
  startOfMonth,
  startOfWeek,
} from "./periods";

describe("getPeriodForDate", () => {
  it("assigns P1 to the first day of the month", () => {
    const r = getPeriodForDate("2026-04-01", 15);
    expect(r.key).toBe("2026-04-P1");
    expect(r.start).toBe("2026-04-01");
    expect(r.end).toBe("2026-04-15");
  });

  it("assigns P1 to the split day itself", () => {
    const r = getPeriodForDate("2026-04-15", 15);
    expect(r.key).toBe("2026-04-P1");
  });

  it("assigns P2 to the day after the split day", () => {
    const r = getPeriodForDate("2026-04-16", 15);
    expect(r.key).toBe("2026-04-P2");
    expect(r.start).toBe("2026-04-16");
    expect(r.end).toBe("2026-04-30");
  });

  it("assigns P2 to the last day of the month", () => {
    const r = getPeriodForDate("2026-04-30", 15);
    expect(r.key).toBe("2026-04-P2");
    expect(r.end).toBe("2026-04-30");
  });

  it("handles February end of month correctly (non-leap)", () => {
    const r = getPeriodForDate("2026-02-28", 15);
    expect(r.key).toBe("2026-02-P2");
    expect(r.end).toBe("2026-02-28");
  });

  it("handles leap year February 29", () => {
    const r = getPeriodForDate("2024-02-29", 15);
    expect(r.key).toBe("2024-02-P2");
    expect(r.end).toBe("2024-02-29");
  });

  it("handles splitDay = 1 (P1 is just the 1st)", () => {
    const r = getPeriodForDate("2026-04-01", 1);
    expect(r.key).toBe("2026-04-P1");
    expect(r.start).toBe("2026-04-01");
    expect(r.end).toBe("2026-04-01");
  });

  it("assigns P2 when splitDay = 1 and date is 2nd", () => {
    const r = getPeriodForDate("2026-04-02", 1);
    expect(r.key).toBe("2026-04-P2");
    expect(r.start).toBe("2026-04-02");
  });

  it("handles splitDay = 30 in a 31-day month (P2 is just the 31st)", () => {
    const r = getPeriodForDate("2026-05-31", 30);
    expect(r.key).toBe("2026-05-P2");
    expect(r.start).toBe("2026-05-31");
    expect(r.end).toBe("2026-05-31");
  });

  it("override wins when date falls inside an override range", () => {
    const overrides = { "custom-q1": { start: "2026-01-01", end: "2026-03-31" } };
    const r = getPeriodForDate("2026-02-15", 15, overrides);
    expect(r.key).toBe("custom-q1");
    expect(r.start).toBe("2026-01-01");
    expect(r.end).toBe("2026-03-31");
  });

  it("falls back to normal logic when date is outside all overrides", () => {
    const overrides = { "custom-q1": { start: "2026-01-01", end: "2026-03-31" } };
    const r = getPeriodForDate("2026-04-10", 15, overrides);
    expect(r.key).toBe("2026-04-P1");
  });
});

describe("getRangeForPeriodKey", () => {
  it("resolves a standard P1 key", () => {
    const r = getRangeForPeriodKey("2026-04-P1", 15);
    expect(r).not.toBeNull();
    expect(r!.start).toBe("2026-04-01");
    expect(r!.end).toBe("2026-04-15");
  });

  it("resolves a standard P2 key", () => {
    const r = getRangeForPeriodKey("2026-04-P2", 15);
    expect(r).not.toBeNull();
    expect(r!.start).toBe("2026-04-16");
    expect(r!.end).toBe("2026-04-30");
  });

  it("returns null for an invalid key format", () => {
    expect(getRangeForPeriodKey("not-a-key", 15)).toBeNull();
    expect(getRangeForPeriodKey("2026-04-P3", 15)).toBeNull();
    expect(getRangeForPeriodKey("", 15)).toBeNull();
  });

  it("resolves an override key by its exact string", () => {
    const overrides = { "custom-q1": { start: "2026-01-01", end: "2026-03-31" } };
    const r = getRangeForPeriodKey("custom-q1", 15, overrides);
    expect(r).not.toBeNull();
    expect(r!.start).toBe("2026-01-01");
    expect(r!.end).toBe("2026-03-31");
  });

  it("P2 end of February is correct in a non-leap year", () => {
    const r = getRangeForPeriodKey("2026-02-P2", 15);
    expect(r!.end).toBe("2026-02-28");
  });

  it("P2 end of February is correct in a leap year", () => {
    const r = getRangeForPeriodKey("2024-02-P2", 15);
    expect(r!.end).toBe("2024-02-29");
  });
});

describe("addDays", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("handles zero days", () => {
    expect(addDays("2026-04-15", 0)).toBe("2026-04-15");
  });

  it("handles negative days (go backwards)", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("startOfMonth / endOfMonth", () => {
  it("returns correct start and end for April", () => {
    expect(startOfMonth("2026-04-15")).toBe("2026-04-01");
    expect(endOfMonth("2026-04-15")).toBe("2026-04-30");
  });

  it("returns Feb 28 as end of month in a non-leap year", () => {
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });

  it("returns Feb 29 as end of month in a leap year", () => {
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });
});

describe("startOfWeek / endOfWeek", () => {
  // 2026-06-10 is a Wednesday
  it("Sunday start: week spans Jun 7–13 for a Wednesday", () => {
    expect(startOfWeek("2026-06-10", 0)).toBe("2026-06-07");
    expect(endOfWeek("2026-06-10", 0)).toBe("2026-06-13");
  });

  it("Monday start: week spans Jun 8–14 for a Wednesday", () => {
    expect(startOfWeek("2026-06-10", 1)).toBe("2026-06-08");
    expect(endOfWeek("2026-06-10", 1)).toBe("2026-06-14");
  });

  it("Sunday start: week starts on Sunday itself", () => {
    expect(startOfWeek("2026-06-07", 0)).toBe("2026-06-07");
  });

  it("Monday start: week starts on Monday itself", () => {
    expect(startOfWeek("2026-06-08", 1)).toBe("2026-06-08");
  });
});
