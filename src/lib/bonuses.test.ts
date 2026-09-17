import { describe, it, expect } from "vitest";
import {
  filterBonusesInRange,
  sumBonuses,
  periodTotalPay,
} from "./bonuses";
import { fmtMoney } from "./earnings";
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

  // The card prints "Flag pay $X + Spiffs $Y = $Z", all three through the
  // whole-dollar fmtMoney. If `total` were the raw sum, the three figures would
  // round independently and the sentence would be arithmetically false on
  // screen: 489.70 + 27.50 printed "$490 + $28 = $517".
  //
  // Both directions of the failure are covered below: fractional parts that sum
  // to >= $1 (raw sum rounds a dollar LOW) and parts that don't (raw sum rounds
  // a dollar HIGH).
  describe("the printed breakdown adds up", () => {
    // fmtMoney -> "$1,234"; parse back so we can add the PRINTED figures.
    const parse = (s: string) => Number(s.replace(/[$,]/g, ""));

    const cases: ReadonlyArray<{ flag: number; bonus: number; why: string }> = [
      { flag: 489.7, bonus: 27.5, why: "reported case 1 (.70 + .50 carries)" },
      { flag: 709.7, bonus: 27.5, why: "reported case 2 (.70 + .50 carries)" },
      { flag: 100.4, bonus: 50.4, why: "fractions sum to 0.80 — no carry" },
      { flag: 0.4, bonus: 0.4, why: "both terms round away to $0" },
      { flag: 100.6, bonus: 50.6, why: "both terms round UP, fractions carry" },
      { flag: 12.5, bonus: 12.5, why: "exact halves, round half away from zero" },
      { flag: 1000, bonus: 234.56, why: "comma grouping in the printed string" },
      { flag: 3455.4999999999995, bonus: 0, why: "float dust from rate x hours" },
    ];

    for (const { flag, bonus: bonusAmt, why } of cases) {
      it(`${flag} + ${bonusAmt}: ${why}`, () => {
        const r = periodTotalPay(flag, bonusAmt);
        const printedFlag = parse(fmtMoney(r.flagPay ?? 0));
        const printedBonus = parse(fmtMoney(r.bonusTotal));
        const printedTotal = parse(fmtMoney(r.total));
        expect(printedFlag + printedBonus).toBe(printedTotal);
      });
    }

    it("holds when no rates are priced (flagPay null prints nothing)", () => {
      const r = periodTotalPay(null, 27.5);
      expect(fmtMoney(r.total)).toBe(fmtMoney(r.bonusTotal));
    });

    it("leaves the exact terms unrounded for any non-display consumer", () => {
      const r = periodTotalPay(489.7, 27.5);
      expect(r.flagPay).toBe(489.7);
      expect(r.bonusTotal).toBe(27.5);
      expect(r.total).toBe(518); // 490 + 28, NOT round(517.20)
    });

    it("still shows the breakdown for a spiff that prints as $0", () => {
      // Rounding must not silently swallow a real row out of the sentence.
      const r = periodTotalPay(400, 0.4);
      expect(r.showBreakdown).toBe(true);
    });
  });
});
