// The predicate behind the withheld efficiency percentage.
//
// The rendered contradiction is pinned next door in
// components/pay-period/PeriodHero.test.tsx. This file pins the boundary the
// copy depends on, and — more importantly — the cases that must KEEP printing.
// A withhold rule that quietly widens is how a real 0% (clocked all day, flagged
// nothing) would stop being reported, and that number is the whole reason a tech
// looks at this app.
import { describe, it, expect } from "vitest";
import { efficiencyDisplay } from "./efficiency-display";

describe("efficiencyDisplay — what must still be shown", () => {
  it("prints a fully-measured 0%", () => {
    // 8 clocked hours, nothing flagged. True, useful, alarming — never hidden.
    expect(
      efficiencyDisplay({ flagHours: 0, efficiency: 0, unpairedFlagHours: 0, unpairedDays: 0 }),
    ).toEqual({ kind: "shown", pct: 0 });
  });

  it("prints a normal figure when a minority of the work is excluded", () => {
    // The visual-fixture shape: one unscheduled Saturday in an otherwise
    // clocked period.
    expect(
      efficiencyDisplay({
        flagHours: 30.8,
        efficiency: 62,
        unpairedFlagHours: 2.8,
        unpairedDays: 1,
      }),
    ).toEqual({ kind: "shown", pct: 62 });
  });

  it("passes the no-schedule shape straight through", () => {
    // aggregateStats divides period totals, never per day, so it has no
    // excluded-day concept and the optional fields are simply absent. Absent
    // must not read as "excluded".
    expect(efficiencyDisplay({ flagHours: 40, efficiency: 90 })).toEqual({
      kind: "shown",
      pct: 90,
    });
  });

  it("reports plain absence when there is nothing measured and nothing excluded", () => {
    expect(
      efficiencyDisplay({ flagHours: 0, efficiency: null, unpairedFlagHours: 0, unpairedDays: 0 }),
    ).toEqual({ kind: "none" });
  });
});

describe("efficiencyDisplay — the hollowed numerator", () => {
  it("names the state when every flagged hour is excluded", () => {
    // 2026-08-18 exactly: 42.0h across an unscheduled Saturday and a shift still
    // in progress, over a denominator made of one day with no flagged work.
    expect(
      efficiencyDisplay({
        flagHours: 42,
        efficiency: 0,
        unpairedFlagHours: 42,
        unpairedDays: 2,
      }),
    ).toEqual({ kind: "all_excluded", excludedHours: 42, days: 2 });
  });

  it("still names it when there is no denominator at all", () => {
    // Day one of a period: nothing measurable anywhere, so efficiency is null.
    // Before this the hero printed no efficiency clause and no reason either —
    // a silent blank next to a confident projection.
    expect(
      efficiencyDisplay({
        flagHours: 12,
        efficiency: null,
        unpairedFlagHours: 12,
        unpairedDays: 1,
      }),
    ).toEqual({ kind: "all_excluded", excludedHours: 12, days: 1 });
  });

  it("withholds at exactly a 2x understatement, and prints just past it", () => {
    // The boundary the constant defines: counted share 1/2 means the figure on
    // screen is wrong by more than it is right.
    expect(
      efficiencyDisplay({
        flagHours: 40,
        efficiency: 50,
        unpairedFlagHours: 20,
        unpairedDays: 1,
      }).kind,
    ).toBe("mostly_excluded");

    // One tenth of an hour the other side of it.
    expect(
      efficiencyDisplay({
        flagHours: 40,
        efficiency: 50,
        unpairedFlagHours: 19.9,
        unpairedDays: 1,
      }).kind,
    ).toBe("shown");
  });

  it("carries the totals the copy needs for the partial case", () => {
    expect(
      efficiencyDisplay({
        flagHours: 40,
        efficiency: 50,
        unpairedFlagHours: 36,
        unpairedDays: 1,
      }),
    ).toEqual({
      kind: "mostly_excluded",
      excludedHours: 36,
      totalHours: 40,
      days: 1,
    });
  });

  it("treats float dust in the numerator as empty, not as work", () => {
    // 0.1 + 0.2 arithmetic leaves a counted remainder of ~4e-15. That is not a
    // "mostly excluded" period with a sliver of measured work in it.
    const r = efficiencyDisplay({
      flagHours: 0.3,
      efficiency: 0,
      unpairedFlagHours: 0.1 + 0.2,
      unpairedDays: 1,
    });
    expect(r.kind).toBe("all_excluded");
  });
});

describe("degenerate inputs cannot reach the screen", () => {
  // None of these are reachable from today's producers. They are guarded
  // because the classifier's contract makes both unpaired* fields optional, so
  // a future caller can legally supply half of them — and the failure mode is
  // a headline reading "NaN%" or "landed on 0 days", which is worse than any
  // percentage it could have printed.
  it("never lets a NaN reach the rendered output", () => {
    // The contract is "no NaN on screen", not "suppress the figure": a real
    // efficiency of 50 is still worth printing even if the hours total is
    // garbage. What must never happen is an excludedHours of NaN being
    // formatted into a sentence.
    const d = efficiencyDisplay({ flagHours: NaN, efficiency: 50 });
    for (const v of Object.values(d)) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("does not print NaN when the excluded hours are NaN", () => {
    const d = efficiencyDisplay({
      flagHours: 10,
      efficiency: 50,
      unpairedFlagHours: NaN,
    });
    if (d.kind === "all_excluded" || d.kind === "mostly_excluded") {
      expect(Number.isFinite(d.excludedHours)).toBe(true);
    }
    expect(d.kind).toBe("shown");
  });

  it("never says the hours landed on zero days", () => {
    // unpairedFlagHours supplied without unpairedDays.
    const d = efficiencyDisplay({
      flagHours: 10,
      efficiency: 50,
      unpairedFlagHours: 9,
    });
    expect(d.kind).toBe("mostly_excluded");
    if (d.kind === "mostly_excluded") expect(d.days).toBeGreaterThanOrEqual(1);
  });

  it("still reports the real day count when it is given one — the control", () => {
    const d = efficiencyDisplay({
      flagHours: 10,
      efficiency: 50,
      unpairedFlagHours: 9,
      unpairedDays: 4,
    });
    if (d.kind === "mostly_excluded") expect(d.days).toBe(4);
  });
});
