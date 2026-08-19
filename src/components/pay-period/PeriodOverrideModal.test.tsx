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
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import {
  PeriodOverrideModal,
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

// ───────────────────────────────────────────────────────────────────────────
// The SECOND bug in this modal: it printed the percentage the page refused to.
//
// `zero-efficiency-hero-copy` gated the hero and the dashboard tile. The
// custom-dates preview kept calling fmtPct(before.efficiency) raw, so for the
// very same range the hero was withholding, this modal stated a figure — and
// stated it as a DELTA, which is a stronger claim than a bare number: an arrow
// between two percentages says "this changed from X to Y", and when one side is
// a hollowed-out numerator the arrow is describing a movement that did not
// happen.
//
// The behaviour under test is not "hide the number". It is: a comparison needs
// two comparable numbers, and when it hasn't got them it says so instead of
// drawing an arrow.
// ───────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/actions/settings", () => ({
  setPeriodOverrideAction: vi.fn(),
}));

afterEach(cleanup);

// ONE locator for both directions. The controls below reuse this exact
// constant, so a negative assertion cannot pass because the regex went stale
// (memory/feedback_negative_assertions_go_vacuous.md).
const ANY_PCT = /\d+%/;

// Sat 2026-07-18: 20.0h flagged, unscheduled and unclocked → unpairable.
// Mon 2026-07-20:  2.0h flagged on a scheduled 8.0h day → counted.
// Tue 2026-07-21: 12.0h flagged on a scheduled 8.0h day → counted.
const D_ENTRIES: Entry[] = [
  entry("2026-07-18", 20),
  entry("2026-07-20", 2),
  entry("2026-07-21", 12),
];
const D_CLOCKS: DailyClock[] = [];
// Mon–Fri of that week. Before-range efficiency is a clean, measurable
// 14.0h ÷ 16.0h = 88%, with nothing excluded.
const D_RANGE = { start: "2026-07-20", end: "2026-07-24" };
const D_TODAY = "2026-07-27";
const D_SCHEDULE = scheduleContextFrom(
  {
    schedules: [SCHEDULE_5X8],
    daysOff: [],
    confirmedZeroDays: [],
    today: D_TODAY,
    shiftOverrides: {},
  },
  D_TODAY,
);

function openModal(range: { start: string; end: string } = D_RANGE) {
  return render(
    <PeriodOverrideModal
      open
      periodKey="2026-07-B"
      initialRange={{ key: "2026-07-B", start: range.start, end: range.end }}
      entries={D_ENTRIES}
      clocks={D_CLOCKS}
      unpaid={[]}
      schedule={D_SCHEDULE}
      rates={{}}
      paidFlagHours={null}
      onClose={() => {}}
    />,
  );
}

/** Drag the start date back — the impact block only renders once dates differ. */
function setStart(value: string) {
  const input = document.getElementById("period-override-start");
  if (!input) throw new Error("no start input");
  fireEvent.change(input, { target: { value } });
}

function setEnd(value: string) {
  const input = document.getElementById("period-override-end");
  if (!input) throw new Error("no end input");
  fireEvent.change(input, { target: { value } });
}

describe("the custom-dates preview never states a percentage the page withholds", () => {
  it("sanity-checks the fixture: the two ranges really are shown vs withheld", () => {
    const before = snapshot(D_ENTRIES, D_CLOCKS, [], D_SCHEDULE, {}, D_RANGE);
    const after = snapshot(D_ENTRIES, D_CLOCKS, [], D_SCHEDULE, {}, {
      start: "2026-07-18",
      end: D_RANGE.end,
    });

    expect(before.efficiencyDisplay.kind).toBe("shown");
    expect(fmtPct(before.efficiency)).toBe("88%");
    // 20.0h of the 34.0h flagged in the wider range is unpairable, so the
    // percentage there would describe well under half the work.
    expect(after.efficiencyDisplay.kind).toBe("mostly_excluded");
  });

  it("draws no arrow and prints no percentage when one side is withheld", () => {
    openModal();
    setStart("2026-07-18");

    const text = document.body.textContent ?? "";
    // The preview is live — the rows that CAN be compared still are.
    expect(text).toMatch(/Flagged hours/);
    expect(text).toMatch(/34\.0h/);
    // And the efficiency row says so in words rather than drawing 88% → 88%.
    expect(text).toMatch(/nothing to compare/);
    expect(text).toMatch(/No efficiency comparison for these dates/);
    expect(text).not.toMatch(ANY_PCT);
  });

  // "no percentage exists here" and "the percentage that exists would be a lie"
  // are different facts (memory/feedback_undefined_is_not_absent.md). A tech who
  // widened a range into an empty weekend has excluded nothing, and telling him
  // about hours the app could not measure — when there are none — is noise.
  it("keeps the plain em dash for a range with nothing to measure at all", () => {
    openModal({ start: "2026-07-11", end: "2026-07-12" }); // Sat + Sun, no work
    setEnd("2026-07-11");

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Efficiency—/);
    expect(text).not.toMatch(/nothing to compare/);
    expect(text).not.toMatch(/No efficiency comparison for these dates/);
  });

  it("compares normally when both sides are measurable — the control", () => {
    // Same ANY_PCT locator. Moving the start FORWARD to the Tuesday keeps every
    // flagged hour on a day with a known length, so the row is an honest
    // 88% → 150% with the arrow it deserves.
    openModal();
    setStart("2026-07-21");

    const text = document.body.textContent ?? "";
    expect(text).toMatch(ANY_PCT);
    expect(text).toMatch(/88%/);
    expect(text).toMatch(/150%/);
    expect(text).toMatch(/→/);
    expect(text).not.toMatch(/nothing to compare/);
    expect(text).not.toMatch(/No efficiency comparison for these dates/);
  });
});
