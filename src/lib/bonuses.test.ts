import { describe, it, expect } from "vitest";
import {
  filterBonusesInRange,
  sumBonuses,
  periodTotalPay,
} from "./bonuses";
import type { Bonus } from "./types";

function bonus(over: Partial<Bonus> = {}): Bonus {
  return {
    id: over.id ?? "b",
    userId: "u",
    date: over.date ?? "2026-07-10",
    amount: over.amount ?? 25,
    category: over.category ?? "spiff",
    source: over.source ?? null,
    note: over.note ?? null,
    entryId: over.entryId ?? null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("filterBonusesInRange", () => {
  const list = [
    bonus({ id: "before", date: "2026-06-30" }),
    bonus({ id: "start", date: "2026-07-01" }),
    bonus({ id: "mid", date: "2026-07-10" }),
    bonus({ id: "end", date: "2026-07-15" }),
    bonus({ id: "after", date: "2026-07-16" }),
  ];

  it("includes bonuses ON both boundary dates (inclusive range)", () => {
    const inRange = filterBonusesInRange(list, "2026-07-01", "2026-07-15");
    const ids = inRange.map((b) => b.id);
    expect(ids).toContain("start"); // exactly on start date
    expect(ids).toContain("end"); // exactly on end date
    expect(ids).toContain("mid");
  });

  it("excludes bonuses just outside the boundaries", () => {
    const inRange = filterBonusesInRange(list, "2026-07-01", "2026-07-15");
    const ids = inRange.map((b) => b.id);
    expect(ids).not.toContain("before"); // day before start
    expect(ids).not.toContain("after"); // day after end
    expect(inRange).toHaveLength(3);
  });

  it("respects a custom period override range", () => {
    // A user-overridden period (e.g. a short custom window) filters the same way.
    const inRange = filterBonusesInRange(list, "2026-07-10", "2026-07-10");
    expect(inRange.map((b) => b.id)).toEqual(["mid"]);
  });

  it("returns an empty array for an empty input set", () => {
    expect(filterBonusesInRange([], "2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("sumBonuses", () => {
  it("totals mixed categories and amounts", () => {
    const total = sumBonuses([
      bonus({ amount: 25, category: "spiff" }),
      bonus({ amount: 100, category: "bonus" }),
      bonus({ amount: 12.5, category: "holiday" }),
    ]);
    expect(total).toBe(137.5);
  });

  it("is 0 for an empty set", () => {
    expect(sumBonuses([])).toBe(0);
  });
});

describe("periodTotalPay", () => {
  it("combines flag pay and spiffs when rates exist", () => {
    const r = periodTotalPay(400, 60);
    expect(r.total).toBe(460);
    expect(r.flagPay).toBe(400);
    expect(r.bonusTotal).toBe(60);
    expect(r.showBreakdown).toBe(true); // both present → show "X + Y = Z"
  });

  it("still totals spiffs with NO rates priced (flagPay null)", () => {
    const r = periodTotalPay(null, 75);
    expect(r.total).toBe(75); // dollars come through even without rates
    expect(r.flagPay).toBeNull();
    expect(r.showBreakdown).toBe(false); // no flag-pay figure to break down against
  });

  it("hides the breakdown when there are no bonuses", () => {
    const r = periodTotalPay(400, 0);
    expect(r.total).toBe(400);
    expect(r.showBreakdown).toBe(false); // nothing to add — don't clutter
  });

  it("is 0 total when both flag pay and bonuses are empty", () => {
    const r = periodTotalPay(null, 0);
    expect(r.total).toBe(0);
    expect(r.showBreakdown).toBe(false);
  });
});
