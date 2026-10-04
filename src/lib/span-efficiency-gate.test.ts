// History's chart bars and /pay-period must withhold efficiency on exactly the
// same periods (escalation `history-bar-efficiency-ungated`, 2026-10-04).
//
// Two paths, one question: "is this period's percentage honest?"
//   - /pay-period: aggregateStatsWithSchedule -> efficiencyDisplay
//   - History bar: dailyDenominators -> spanEfficiency -> spanEfficiencyDisplay
// Both ride pairDay(); these tests pin that the DISPLAY decision agrees too.
import { describe, it, expect } from "vitest";
import {
  aggregateStatsWithSchedule,
  dailyDenominators,
  spanEfficiency,
  type ScheduleContext,
} from "./stats";
import { efficiencyDisplay, spanEfficiencyDisplay } from "./efficiency-display";
import { emptyWeek, type WorkSchedule } from "./schedule";
import type { DailyClock, Entry } from "./types";

const SHIFT_8 = { start: "08:00", end: "17:00", breakMin: 60 };
const SCHEDULE: WorkSchedule = {
  id: "s1",
  effectiveFrom: "2026-09-28",
  rotationWeeks: 1,
  anchorMonday: "2026-09-28",
  weeks: [{ ...emptyWeek(), mon: SHIFT_8, tue: SHIFT_8, wed: SHIFT_8, thu: SHIFT_8, fri: SHIFT_8 }],
  createdAt: "2026-09-28T00:00:00Z",
};
const RANGE = { start: "2026-10-01", end: "2026-10-15" };
const TODAY = "2026-10-05"; // Monday, nothing logged yet

function ctx(): ScheduleContext {
  return { schedules: [SCHEDULE], daysOff: [], confirmedZeroDays: [], today: TODAY };
}
function entry(date: string, flagHours: number): Entry {
  return { id: date, date, flagHours, roNumber: date, opCodes: [], notes: "" } as unknown as Entry;
}
function clock(date: string, hours: number): DailyClock {
  return { date, hours } as unknown as DailyClock;
}

/** Both paths, same inputs. */
function bothPaths(entries: Entry[], clocks: DailyClock[]) {
  const c = ctx();
  const payPeriod = efficiencyDisplay(aggregateStatsWithSchedule(entries, clocks, RANGE, c));
  const denom = dailyDenominators(entries, clocks, RANGE, TODAY, c);
  const history = spanEfficiencyDisplay(spanEfficiency(entries, denom, RANGE.start, RANGE.end));
  return { payPeriod, history };
}

describe("History bar withholds exactly when /pay-period does", () => {
  it("Oct 1-15 shape: most flag hours on unmeasurable days -> mostly_excluded on both", () => {
    // Thu/Fri clocked 8h each (20 flag measured). Sat (unscheduled) and Sun
    // carry 60 flag with nothing to measure them against.
    const entries = [
      entry("2026-10-01", 10),
      entry("2026-10-02", 10),
      entry("2026-10-03", 30),
      entry("2026-10-04", 30),
    ];
    const clocks = [clock("2026-10-01", 8), clock("2026-10-02", 8)];
    const { payPeriod, history } = bothPaths(entries, clocks);
    expect(payPeriod.kind).toBe("mostly_excluded");
    expect(history).toEqual(payPeriod);
  });

  it("every flag hour unmeasurable -> all_excluded on both", () => {
    const entries = [entry("2026-10-03", 20), entry("2026-10-04", 20)];
    const clocks = [clock("2026-10-01", 8)]; // a clocked day with no work gives a denominator
    const { payPeriod, history } = bothPaths(entries, clocks);
    expect(payPeriod.kind).toBe("all_excluded");
    expect(history).toEqual(payPeriod);
  });

  it("fully measured period prints the same percentage on both", () => {
    const entries = [entry("2026-10-01", 9), entry("2026-10-02", 7)];
    const clocks = [clock("2026-10-01", 8), clock("2026-10-02", 8)];
    const { payPeriod, history } = bothPaths(entries, clocks);
    expect(payPeriod).toEqual({ kind: "shown", pct: 100 });
    expect(history).toEqual(payPeriod);
  });

  it("a small excluded share still prints, on both", () => {
    const entries = [entry("2026-10-01", 16), entry("2026-10-03", 2)];
    const clocks = [clock("2026-10-01", 8)];
    const { payPeriod, history } = bothPaths(entries, clocks);
    expect(payPeriod.kind).toBe("shown");
    expect(history).toEqual(payPeriod);
  });

  it("exactly half excluded is the boundary and is withheld on both", () => {
    const entries = [entry("2026-10-01", 8), entry("2026-10-03", 8)];
    const clocks = [clock("2026-10-01", 8)];
    const { payPeriod, history } = bothPaths(entries, clocks);
    expect(payPeriod.kind).toBe("mostly_excluded");
    expect(history).toEqual(payPeriod);
  });

  it("nothing flagged and nothing excluded stays blank (unchanged)", () => {
    const { history } = bothPaths([], [clock("2026-10-01", 8)]);
    // Nothing flagged, nothing excluded: the chart has always left this blank.
    expect(history.kind).toBe("none");
  });

  it("no counted day at all -> none (the no-schedule case, not withholding)", () => {
    const denom = dailyDenominators([entry("2026-10-03", 5)], [], RANGE, TODAY, null);
    expect(spanEfficiencyDisplay(spanEfficiency([entry("2026-10-03", 5)], denom, RANGE.start, RANGE.end))).toEqual({
      kind: "none",
    });
  });
});
