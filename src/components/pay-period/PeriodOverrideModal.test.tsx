// @vitest-environment jsdom
//
// Regression cover for `custom-dates-efficiency-double`.
//
// The custom-dates modal printed 365% efficiency while the hero and the stats
// grid on the SAME page printed 183%, for the identical unchanged range. Both
// sides of the arithmetic were correct; they were fed different schedule
// context. PayPeriodView hand-wrote the modal's ScheduleContext and passed
// `confirmedZeroDays: []`, so under the shared pairDay rule every confirmed
// real-zero day fell out of "counted" into "unresolved" and vanished from the
// denominator — 29.2h ÷ 8.0h instead of 29.2h ÷ 16.0h.
//
// WHY THIS TESTS THE ADAPTER AND NOT THE RENDERED PAGE:
// `snapshot()` alone cannot catch this bug — it takes a ScheduleContext as an
// input and was always correct. The defect lives in the conversion FROM the
// page's ScheduleFallback INTO that context, which is why that conversion is
// now an exported function (`scheduleContextFrom`) instead of an object literal
// at a call site. Driving the whole PayPeriodView through RTL would exercise
// the same two functions plus nine sibling cards, and would then fail whenever
// any of those cards was mid-edit — a regression test that goes red for other
// people's reasons gets muted, which is how the original gate was lost.
//
// The assertion is the invariant the bug broke: the modal's before-snapshot
// figure EQUALS the page's figure for an unchanged range.
import { describe, it, expect } from "vitest";
import {
  scheduleContextFrom,
  snapshot,
} from "./PeriodOverrideModal";
import { aggregateStatsWithSchedule, fmtPct } from "@/lib/stats";
import type { ScheduleFallback } from "@/lib/wage-check";
import type { DailyClock, Entry } from "@/lib/types";
import type { WorkSchedule } from "@/lib/schedule";

// Mon–Fri 08:00–16:30 with a 30-minute unpaid break = 8.0 paid hours.
const DAY_SHIFT = { start: "08:00", end: "16:30", breakMin: 30 };

const SCHEDULE_5X8: WorkSchedule = {
  id: "s1",
  effectiveFrom: "2026-01-01",
  rotationWeeks: 1,
  // 2026-01-05 is a Monday.
  anchorMonday: "2026-01-05",
  weeks: [
    {
      mon: DAY_SHIFT,
      tue: DAY_SHIFT,
      wed: DAY_SHIFT,
      thu: DAY_SHIFT,
      fri: DAY_SHIFT,
      sat: null,
      sun: null,
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
};

function entry(date: string, flagHours: number): Entry {
  return {
    id: `e-${date}`,
    userId: "u1",
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
    date,
    roNumber: "RO",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    flagHours,
    notes: "",
    opCodes: [
      {
        id: `oc-${date}`,
        opCodeId: null,
        custom: true,
        customCode: "T",
        customDescription: "Test",
        flagHours,
        actualHours: null,
        notes: "",
        position: 0,
        subOpCodeId: null,
        laborType: "customer_pay",
      },
    ],
  };
}

// The exact shape of the escalated report.
//
//  - 2026-07-20 (Mon): 29.2 flagged hours, never clocked → the schedule fills
//    it with 8.0h. Counted either way, because flag > 0.
//  - 2026-07-21 (Tue): scheduled, zero flagged hours, no clock — a "Worked,
//    unpaid" day the tech confirmed. It contributes 8.0h of DENOMINATOR and
//    nothing to the numerator, and it is counted ONLY because it appears in
//    confirmedZeroDays. Drop that list and pairDay returns `unresolved` and the
//    day leaves the denominator entirely.
//
// So the fixture is discriminating by construction: 29.2/16.0 = 183% with the
// field threaded, 29.2/8.0 = 365% without it. `today` is the following
// Saturday so both days are completed (a day at or after today has no
// denominator at all, which would mask the difference).
const RANGE = { start: "2026-07-16", end: "2026-07-31" };
const TODAY = "2026-07-25";
const ENTRIES: Entry[] = [entry("2026-07-20", 29.2)];
const CLOCKS: DailyClock[] = [];
const CONFIRMED_ZERO = ["2026-07-21"];

// What the page hands PayPeriodView — the same object literal pay-period/page
// builds, with every field populated from the DB.
const PAGE_SCHEDULE: ScheduleFallback = {
  schedules: [SCHEDULE_5X8],
  daysOff: [],
  confirmedZeroDays: CONFIRMED_ZERO,
  today: TODAY,
  shiftOverrides: {},
};

// The hero / stats-grid derivation, exactly as pay-period/page.tsx computes it.
function heroStats() {
  return aggregateStatsWithSchedule(
    ENTRIES,
    CLOCKS,
    RANGE,
    {
      schedules: PAGE_SCHEDULE.schedules,
      daysOff: PAGE_SCHEDULE.daysOff,
      confirmedZeroDays: CONFIRMED_ZERO,
      today: TODAY,
      shiftOverrides: {},
    },
    [],
  );
}

describe("custom-dates modal agrees with the page it opened on top of", () => {
  it("shows the hero's efficiency for an unchanged range", () => {
    const hero = heroStats();
    const before = snapshot(
      ENTRIES,
      CLOCKS,
      [],
      scheduleContextFrom(PAGE_SCHEDULE, TODAY),
      {},
      RANGE,
    );

    expect(before.efficiency).toBe(hero.efficiency);
    expect(fmtPct(before.efficiency)).toBe(fmtPct(hero.efficiency));
    // Pinned, so a change in either derivation has to be argued for rather
    // than absorbed by both sides moving together.
    expect(before.denomHours).toBe(16);
    expect(fmtPct(before.efficiency)).toBe("183%");
  });

  it("carries confirmedZeroDays through the conversion", () => {
    expect(scheduleContextFrom(PAGE_SCHEDULE, TODAY)?.confirmedZeroDays).toEqual(
      CONFIRMED_ZERO,
    );
  });

  // The control case. Without it the assertion above could pass for a fixture
  // where confirmedZeroDays never mattered — an equality that holds because
  // both sides are blind, not because the field arrived.
  it("would disagree if the list were dropped — the fixture can tell", () => {
    const hero = heroStats();
    const dropped = snapshot(
      ENTRIES,
      CLOCKS,
      [],
      scheduleContextFrom({ ...PAGE_SCHEDULE, confirmedZeroDays: [] }, TODAY),
      {},
      RANGE,
    );

    expect(dropped.denomHours).toBe(8);
    expect(fmtPct(dropped.efficiency)).toBe("365%");
    expect(dropped.efficiency).not.toBe(hero.efficiency);
  });

  it("returns null when there is no schedule, so the modal falls back to clocked hours", () => {
    expect(scheduleContextFrom(null, TODAY)).toBeNull();
    expect(
      scheduleContextFrom({ ...PAGE_SCHEDULE, schedules: [] }, TODAY),
    ).toBeNull();
  });
});
