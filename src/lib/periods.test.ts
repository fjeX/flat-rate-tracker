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

// The bug a real user reported (2026-08-01): a period overridden to end early
// still swallowed the days after it, because only getRangeForPeriodKey applied
// the override. These use his actual settings — splitDay 14, and the chain of
// overrides his shop's drifting pay dates forced him to create by hand.
describe("period chain — a period overridden to end early hands off the rest", () => {
  const SPLIT = 14;
  const drifted = {
    "2026-07-P1": { start: "2026-06-30", end: "2026-07-14" },
    "2026-07-P2": { start: "2026-07-15", end: "2026-07-30" },
  };

  it("rolls the day after an early close into the NEXT period, uncreated", () => {
    // Jul 31 is past the overridden end of 2026-07-P2. It used to come back as
    // 2026-07-P2 (day 31 > splitDay → default P2 math), filing the day's work
    // into the period that had already closed.
    const r = getPeriodForDate("2026-07-31", SPLIT, drifted);
    expect(r.key).toBe("2026-08-P1");
    expect(r.start).toBe("2026-07-31");
    expect(r.end).toBe("2026-08-14");
  });

  it("keeps the last day of the overridden period in it", () => {
    expect(getPeriodForDate("2026-07-30", SPLIT, drifted).key).toBe("2026-07-P2");
  });

  it("agrees with getRangeForPeriodKey about where the boundary is", () => {
    // The actual defect was these two disagreeing. Assert the invariant
    // directly: every day either side of the seam resolves to a key whose
    // range contains it.
    for (const date of [
      "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-14", "2026-08-15",
    ]) {
      const found = getPeriodForDate(date, SPLIT, drifted);
      const resolved = getRangeForPeriodKey(found.key, SPLIT, drifted);
      expect(resolved).not.toBeNull();
      expect(date >= resolved!.start && date <= resolved!.end).toBe(true);
    }
  });

  it("leaves no day unassigned across a whole drifted month", () => {
    // Walk Jun 30 → Aug 14 and check the periods tile without gap or overlap.
    const seen = new Map<string, string[]>();
    for (let d = "2026-06-30"; d <= "2026-08-14"; d = addDays(d, 1)) {
      const key = getPeriodForDate(d, SPLIT, drifted).key;
      seen.set(key, [...(seen.get(key) ?? []), d]);
    }
    expect([...seen.keys()]).toEqual(["2026-07-P1", "2026-07-P2", "2026-08-P1"]);
    expect(seen.get("2026-07-P1")!.length).toBe(15); // Jun 30 – Jul 14
    expect(seen.get("2026-07-P2")!.length).toBe(16); // Jul 15 – Jul 30
    expect(seen.get("2026-08-P1")!.length).toBe(15); // Jul 31 – Aug 14
  });

  it("hands off backwards too when an override starts late", () => {
    // P2 pushed to start on the 20th: the 15th–19th belong to P1, which grows
    // to meet it rather than leaving them homeless.
    const late = { "2026-07-P2": { start: "2026-07-20", end: "2026-07-31" } };
    const r = getPeriodForDate("2026-07-16", SPLIT, late);
    expect(r.key).toBe("2026-07-P1");
    expect(r.end).toBe("2026-07-19");
  });

  it("crosses a year boundary", () => {
    const yearEnd = { "2026-12-P2": { start: "2026-12-15", end: "2026-12-30" } };
    const r = getPeriodForDate("2026-12-31", 14, yearEnd);
    expect(r.key).toBe("2027-01-P1");
    expect(r.start).toBe("2026-12-31");
    expect(r.end).toBe("2027-01-14");
  });

  it("crosses a year boundary backwards", () => {
    const yearStart = { "2027-01-P1": { start: "2027-01-02", end: "2027-01-14" } };
    const r = getPeriodForDate("2026-12-31", 14, yearStart);
    expect(r.key).toBe("2026-12-P2");
    expect(r.end).toBe("2027-01-01");
  });

  it("still files a day caught between two hand-pinned periods", () => {
    // A hole the tech created explicitly (setPeriodOverrideAction refuses to
    // make these). Nothing can be "right" here — the requirement is only that
    // the day lands somewhere deterministic instead of vanishing.
    const hole = {
      "2026-07-P1": { start: "2026-07-01", end: "2026-07-10" },
      "2026-07-P2": { start: "2026-07-20", end: "2026-07-31" },
    };
    expect(getPeriodForDate("2026-07-15", SPLIT, hole).key).toBeTruthy();
  });
});

describe("getRangeForPeriodKey — chained boundaries", () => {
  const SPLIT = 14;

  it("starts the next period the day after an overridden one ends", () => {
    const r = getRangeForPeriodKey("2026-08-P1", SPLIT, {
      "2026-07-P2": { start: "2026-07-15", end: "2026-07-30" },
    });
    expect(r!.start).toBe("2026-07-31");
    expect(r!.end).toBe("2026-08-14");
  });

  it("ends the previous period the day before an overridden one starts", () => {
    const r = getRangeForPeriodKey("2026-07-P2", SPLIT, {
      "2026-08-P1": { start: "2026-07-31", end: "2026-08-14" },
    });
    expect(r!.start).toBe("2026-07-15");
    expect(r!.end).toBe("2026-07-30");
  });

  it("takes both neighbors into account at once", () => {
    const r = getRangeForPeriodKey("2026-07-P2", SPLIT, {
      "2026-07-P1": { start: "2026-06-30", end: "2026-07-16" },
      "2026-08-P1": { start: "2026-07-29", end: "2026-08-14" },
    });
    expect(r!.start).toBe("2026-07-17");
    expect(r!.end).toBe("2026-07-28");
  });

  it("is unchanged when no neighbor is overridden", () => {
    const r = getRangeForPeriodKey("2026-08-P1", SPLIT, {
      "2026-03-P1": { start: "2026-03-01", end: "2026-03-14" },
    });
    expect(r!.start).toBe("2026-08-01");
    expect(r!.end).toBe("2026-08-14");
  });

  it("re-derives a hand-set boundary from its neighbors alone", () => {
    // A real drifting-shop chain, taken from production. Each of these was typed
    // in by hand, one period at a time, because the resolver couldn't carry a
    // boundary forward. Drop any single one and the chain rule reproduces it
    // exactly — which is the measure of the fix: from here, setting a period's
    // END is enough, and the next period follows on its own.
    const chain: Record<string, { start: string; end: string }> = {
      "2026-05-P2": { start: "2026-05-15", end: "2026-05-28" },
      "2026-06-P1": { start: "2026-05-29", end: "2026-06-14" },
      "2026-06-P2": { start: "2026-06-15", end: "2026-06-29" },
      "2026-07-P1": { start: "2026-06-30", end: "2026-07-14" },
      "2026-07-P2": { start: "2026-07-15", end: "2026-07-30" },
      "2026-08-P1": { start: "2026-07-31", end: "2026-08-14" },
    };
    for (const key of Object.keys(chain)) {
      const withoutIt = { ...chain };
      delete withoutIt[key];
      const derived = getRangeForPeriodKey(key, SPLIT, withoutIt);
      expect({ key, ...derived }).toEqual({ key, ...chain[key] });
    }
  });

  it("collapses rather than inverting when overrides overlap", () => {
    const r = getRangeForPeriodKey("2026-07-P2", SPLIT, {
      "2026-07-P1": { start: "2026-06-30", end: "2026-07-25" },
      "2026-08-P1": { start: "2026-07-20", end: "2026-08-14" },
    });
    expect(r!.start <= r!.end).toBe(true);
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
