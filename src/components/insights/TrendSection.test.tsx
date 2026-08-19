// @vitest-environment jsdom
//
// The /insights half of `zero-efficiency-hero-copy`.
//
// The trend chart printed `fmtPct(point.efficiency)` above every bar with no
// gate at all, so the in-progress period — the one guaranteed to be sitting on
// open days on the 1st and the 16th — rendered a bare `0%` in a row of healthy
// bars. Worse than the hero's version of the bug, because the same ungated
// value also fed the chart's CEILING: it sets bar GEOMETRY, not just a label.
//
// THE TRAP THIS FILE EXISTS TO PIN:
// `PeriodTrendPoint` and `ScheduleStats` use OPPOSITE conventions for unpaired
// hours, with identical field names.
//
//   ScheduleStats.flagHours     RAW total; unpairedFlagHours is a subset of it.
//   PeriodTrendPoint.flagHours  PAIRED total; unpairedFlagHours was never in it.
//
// efficiencyDisplay computes `counted = flagHours - unpairedFlagHours`, so a
// trend point passed in unchanged yields counted = 0 - 42 = -42. No type error,
// no crash, wrong answer. `trendEfficiencyDisplay` is the shape adapter; the
// test marked THE ONE THAT PINS THE INVERSION is the one that goes red if
// anyone removes the addition inside it.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { TrendSection } from "./InsightsView";
import { trendEfficiencyDisplay, type PeriodTrendPoint } from "@/lib/insights";

afterEach(cleanup);

// ONE locator, used by both the "must not appear" and the "must appear" cases.
const ANY_PCT = /\d+%/;

const TODAY = "2026-08-19";

function point(p: Partial<PeriodTrendPoint> & { key: string }): PeriodTrendPoint {
  return {
    label: p.key,
    start: "2026-01-01",
    end: "2026-01-15",
    flagHours: 0,
    denomHours: 0,
    efficiency: null,
    unpairedFlagHours: 0,
    unpairedDays: 0,
    ...p,
  };
}

// Two finished, honestly measured periods…
const JUL_A = point({
  key: "2026-07-A",
  label: "Jul 1–15",
  start: "2026-07-01",
  end: "2026-07-15",
  flagHours: 80,
  denomHours: 80,
  efficiency: 100,
});
const JUL_B = point({
  key: "2026-07-B",
  label: "Jul 16–31",
  start: "2026-07-16",
  end: "2026-07-31",
  flagHours: 96,
  denomHours: 80,
  efficiency: 120,
});

// …and the escalated in-progress period: 42.0h flagged, every hour of it on an
// unscheduled Saturday and a still-open today, against one 8.0h scheduled day
// that had no flagged work on it. Numerator 0 over a real denominator → a
// genuinely computed 0% that describes none of the 42 hours.
const AUG_B_HOLLOW = point({
  key: "2026-08-B",
  label: "Aug 16–31",
  start: "2026-08-16",
  end: "2026-08-31",
  flagHours: 0,
  denomHours: 8,
  efficiency: 0,
  unpairedFlagHours: 42,
  unpairedDays: 2,
});

// The control: the same in-progress period, measured. 42.0h over 32.0h, nothing
// excluded — a real 131% that the chart must keep printing.
const AUG_B_MEASURED = point({
  key: "2026-08-B",
  label: "Aug 16–31",
  start: "2026-08-16",
  end: "2026-08-31",
  flagHours: 42,
  denomHours: 32,
  efficiency: 131.25,
});

function labels(): string[] {
  return Array.from(document.querySelectorAll(".trend-val")).map(
    (el) => el.textContent ?? "",
  );
}

function barHeights(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".trend-bar")).map(
    (el) => parseFloat(el.style.height),
  );
}

describe("the trend-point shape adapter", () => {
  it("classifies the hollowed-out period as fully excluded", () => {
    expect(trendEfficiencyDisplay(AUG_B_HOLLOW)).toEqual({
      kind: "all_excluded",
      excludedHours: 42,
      days: 2,
    });
  });

  // THE ONE THAT PINS THE INVERSION.
  //
  // The all-excluded case above cannot catch a missing `+ unpairedFlagHours`:
  // it lands on all_excluded either way (counted comes out 0 with the addition
  // and -42 without, and both are "< EMPTY_HOURS"). The wrong arithmetic only
  // shows itself where a real majority IS measured.
  //
  // 20.0h paired + 15.0h unpaired = 35.0h flagged. The measured share is
  // 20/35 = 57%, comfortably over the withhold threshold, so this bar keeps its
  // 125%. Drop the addition and the classifier sees 20.0h total against 15.0h
  // excluded — a 25% measured share — and silently withholds a figure that was
  // fine, which is the same class of harm in the opposite direction.
  it("does not withhold a majority-measured period — the inversion shows here", () => {
    const majorityMeasured = point({
      key: "2026-05-A",
      flagHours: 20,
      denomHours: 16,
      efficiency: 125,
      unpairedFlagHours: 15,
      unpairedDays: 2,
    });
    expect(trendEfficiencyDisplay(majorityMeasured)).toEqual({
      kind: "shown",
      pct: 125,
    });
  });

  it("leaves a fully measured point alone", () => {
    expect(trendEfficiencyDisplay(AUG_B_MEASURED)).toEqual({
      kind: "shown",
      pct: 131.25,
    });
  });
});

describe("TrendSection — a hollowed-out bar states nothing", () => {
  it("labels the withheld bar with a dash, never a percentage", () => {
    render(<TrendSection points={[JUL_A, JUL_B, AUG_B_HOLLOW]} today={TODAY} />);

    // The two honest bars still print. Same ANY_PCT the negative uses.
    expect(labels().slice(0, 2)).toEqual(["100%", "120%"]);
    expect(labels()[0]).toMatch(ANY_PCT);
    // The withheld one does not.
    expect(labels()[2]).not.toMatch(ANY_PCT);
    expect(labels()[2]).toBe("—");
  });

  it("still draws the bar — but claims no height", () => {
    // A withheld period whose raw figure is NOT zero, so the stub assertion
    // below discriminates: ungated, this bar would be drawn at 90% of the
    // ceiling on the strength of a percentage the chart is refusing to print.
    const mostlyExcluded = point({
      key: "2026-08-B",
      label: "Aug 16–31",
      start: "2026-08-16",
      end: "2026-08-31",
      flagHours: 4,
      denomHours: 4,
      efficiency: 108,
      unpairedFlagHours: 38,
      unpairedDays: 2,
    });
    render(<TrendSection points={[JUL_A, JUL_B, mostlyExcluded]} today={TODAY} />);

    expect(barHeights()).toHaveLength(3);
    // A visible stub, not a missing column: a period that vanished from the
    // chart would read as a period that never happened.
    expect(barHeights()[2]).toBeGreaterThan(0);
    // But no height is claimed — the bar's height IS its percentage, and there
    // isn't one, so it falls to the same minimum an all-zero period gets.
    expect(barHeights()[2]).toBe(4);
    expect(labels()[2]).toBe("—");
    // The measured bars beside it are untouched.
    expect(labels()[0]).toMatch(ANY_PCT);
  });

  it("keeps a withheld period out of the axis", () => {
    // A FINISHED period whose work is all unpairable — the case that gets past
    // the existing "in-progress periods don't set the scale" rule, because it
    // is not in progress. Its 900% would otherwise squash the real bars.
    const wild = point({
      key: "2026-06-B",
      label: "Jun 16–30",
      start: "2026-06-16",
      end: "2026-06-30",
      flagHours: 0,
      denomHours: 1,
      efficiency: 900,
      unpairedFlagHours: 60,
      unpairedDays: 5,
    });
    render(<TrendSection points={[wild, JUL_A, JUL_B]} today={TODAY} />);

    // Ceiling is 120 (the tallest MEASURED bar), so Jul 16–31 is full height.
    const heights = barHeights();
    expect(heights[2]).toBeCloseTo(108, 5);
    expect(heights[1]).toBeCloseTo((100 / 120) * 108, 5);
    expect(labels()[0]).toBe("—");
  });

  it("prints every percentage when every period is measurable — the control", () => {
    render(<TrendSection points={[JUL_A, JUL_B, AUG_B_MEASURED]} today={TODAY} />);

    expect(labels()).toEqual(["100%", "120%", "131%"]);
    for (const l of labels()) expect(l).toMatch(ANY_PCT);
    expect(labels()).not.toContain("—");
  });
});

describe("TrendSection — the change caption", () => {
  it("compares the last two finished periods when both are measurable", () => {
    render(<TrendSection points={[JUL_A, JUL_B, AUG_B_MEASURED]} today={TODAY} />);

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Jul 16–31 came in at/);
    expect(text).toMatch(/120%/);
    expect(text).toMatch(/up from/);
    expect(text).toMatch(/100%/);
  });

  it("says nothing when one of those two periods has no printable figure", () => {
    // Same two-finished-period setup, except Jul 16–31's hours were unpairable.
    const julBHollow = point({
      ...JUL_B,
      flagHours: 4,
      denomHours: 8,
      efficiency: 50,
      unpairedFlagHours: 92,
      unpairedDays: 6,
    });
    render(<TrendSection points={[JUL_A, julBHollow, AUG_B_MEASURED]} today={TODAY} />);

    const text = document.body.textContent ?? "";
    // "came in at 50%, down from 100%" is the bar label's lie in a full
    // sentence — worse, because a sentence sounds deliberate.
    expect(text).not.toMatch(/came in at/);
    expect(text).not.toMatch(/down from/);
  });
});
