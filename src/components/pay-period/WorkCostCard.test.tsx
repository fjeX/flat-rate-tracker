// @vitest-environment jsdom
//
// Regression cover for the "Ahead" label and its caption on the clock-vs-flag
// gap. The card had no tests at all, which is how a presentation change shipped
// that asserted good news on top of missing data.
//
// THE BUG, as observed against the component at HEAD:
//
//   status: "no_clock", 363.7h flagged, no clock entries
//     "1 day this period has flagged work but no hours on it, so there's no
//      effective hourly yet…"
//     At the shop 0.0h   Flagged 363.7h   Ahead 363.7h
//     "You flagged 363.7h more than you were at the shop this period — you're
//      ahead, not behind. There's no unpaid gap to explain."
//
// A zero denominator is not a tech who is ahead — it is a tech with no clock
// data, which wage-check.ts calls "the NORM, not the exception". Same for
// incomplete_clock: the card warned that four days had no hours on them and
// then congratulated the user on the number derived from those same days.
//
// Two more, same family:
//   - "There's no unpaid gap to explain" rendered directly above a drill-down
//     listing 3.30h of recorded unpaid time. wage-check.ts:307-310 documents
//     that recorded unpaid time can legitimately exceed the gap.
//   - clocked 8.1+8.2+8.3 = 24.599999999999998 against 24.6 flagged is an
//     EVEN period, but float noise made gap < 0 true and printed the whole
//     congratulatory branch.
//
// WHY THESE ASSERT ON THE RENDERED CARD AND NOT ON wage-check:
// the maths is right. clockFlagGap returns exactly what it should in all four
// states and has its own tests. The defect is entirely in which sentence the
// card chooses to print over that number, so the rendered card is the only
// thing that can fail on it.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { WorkCostCard } from "./WorkCostCard";
import type { EffectiveHourly } from "@/lib/wage-check";
import type { UnpaidSummary } from "@/lib/unpaid-summary";

afterEach(cleanup);

// ONE locator per claim, reused by the negative assertions and by the control
// cases that prove the locator still matches something. A "the card does not
// say X" assertion written against a regex that matches nothing passes for
// free (memory/feedback_negative_assertions_go_vacuous.md).
// Deliberately NOT \bAhead\b: the label and its value are adjacent divs, so
// textContent reads "Ahead48.3h" and a word boundary after "d" never matches.
const AHEAD_LABEL = /Ahead/;
const GAP_LABEL = /Gap/;
const AHEAD_CLAIM = /you're ahead, not behind/i;
const NOTHING_TO_EXPLAIN = /no unpaid gap to explain/i;

const NO_UNPAID: UnpaidSummary = {
  lines: [],
  comebackHours: 0,
  waitingHours: 0,
  shopHours: 0,
  totalHours: 0,
  byKind: {
    comeback_own: 0,
    comeback_other: 0,
    rework_same_visit: 0,
    wait_parts: 0,
    wait_approval: 0,
    shop_time: 0,
  },
  totalDollars: null,
  unpricedHours: 0,
  hasRates: false,
};

// 3.30h of waiting on parts — a real ledger row, the kind the Unpaid Time
// Engine exists to capture.
const WITH_UNPAID: UnpaidSummary = {
  ...NO_UNPAID,
  lines: [
    {
      source: "ledger",
      date: "2026-07-14",
      kind: "wait_parts",
      hours: 3.3,
      roNumber: null,
      entryId: null,
      code: null,
      description: "waiting on a water pump",
      dollars: null,
    },
  ],
  waitingHours: 3.3,
  totalHours: 3.3,
  byKind: { ...NO_UNPAID.byKind, wait_parts: 3.3 },
  unpricedHours: 3.3,
};

function result(over: Partial<EffectiveHourly> = {}): EffectiveHourly {
  return {
    hourly: null,
    flagPay: null,
    bonusTotal: 0,
    totalPay: null,
    flagHours: 0,
    countedFlagHours: 0,
    clockedHours: 0,
    denomHours: 0,
    denomSource: null,
    workDays: [],
    clockDays: [],
    scheduledDays: [],
    ongoingDays: [],
    missingClockDays: [],
    status: "no_clock",
    ...over,
  };
}

// The card is a disclosure; everything under test lives in the open body.
// textContent is the assertion surface on purpose — text after a JSX
// expression container silently loses its leading space, and that is invisible
// when reading the source (memory/reference_frt_jsx_whitespace.md).
function renderCard(
  res: EffectiveHourly,
  unpaid: UnpaidSummary = NO_UNPAID,
): string {
  const { container } = render(
    <WorkCostCard
      result={res}
      referenceRate={null}
      unpaid={unpaid}
      defaultOpen
    />,
  );
  return container.textContent ?? "";
}

describe("WorkCostCard — a negative gap with missing clock data", () => {
  it("does not claim the tech is ahead when there are no clocked hours at all", () => {
    const text = renderCard(
      result({
        status: "no_clock",
        flagHours: 363.7,
        countedFlagHours: 363.7,
        workDays: ["2026-07-02"],
        missingClockDays: ["2026-07-02"],
      }),
    );

    // The card still shows the figures — withholding them is not the fix.
    expect(text).toContain("363.7h");
    expect(text).toMatch(/1 day this period has flagged work but no hours on it/);

    expect(text).not.toMatch(AHEAD_LABEL);
    expect(text).not.toMatch(AHEAD_CLAIM);
    expect(text).not.toMatch(NOTHING_TO_EXPLAIN);
  });

  it("does not claim the tech is ahead when some days have no hours on them", () => {
    const text = renderCard(
      result({
        status: "incomplete_clock",
        flagHours: 60,
        countedFlagHours: 60,
        clockedHours: 8,
        denomHours: 8,
        denomSource: "clocked",
        workDays: ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"],
        clockDays: ["2026-07-06"],
        missingClockDays: [
          "2026-07-07",
          "2026-07-08",
          "2026-07-09",
          "2026-07-10",
        ],
      }),
    );

    expect(text).toContain("52.0h"); // the magnitude is still shown
    expect(text).toMatch(/4 days this period have flagged work but no hours on them/);

    expect(text).not.toMatch(AHEAD_LABEL);
    expect(text).not.toMatch(AHEAD_CLAIM);
    expect(text).not.toMatch(NOTHING_TO_EXPLAIN);
  });
});

describe("WorkCostCard — a negative gap with the hours complete", () => {
  // CONTROL for the two tests above: same locators, a state where they MUST
  // match. If these go red the negative assertions above are vacuous.
  it("says the tech is ahead, and that there is nothing to explain, when nothing is recorded", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 27.4,
        flagPay: 2000,
        totalPay: 2420,
        flagHours: 88.3,
        countedFlagHours: 88.3,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-07-13", "2026-07-14"],
        clockDays: ["2026-07-13", "2026-07-14"],
      }),
    );

    expect(text).toMatch(AHEAD_LABEL);
    expect(text).toMatch(AHEAD_CLAIM);
    expect(text).toMatch(NOTHING_TO_EXPLAIN);
    // Whitespace check: read the sentence back out of the DOM, not the source.
    expect(text).toContain(
      "You flagged 48.3h more than you were at the shop this period",
    );
  });

  it("does not say there is nothing to explain when unpaid time is recorded", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 27.4,
        flagPay: 2000,
        totalPay: 2420,
        flagHours: 88.3,
        countedFlagHours: 88.3,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-07-13", "2026-07-14"],
        clockDays: ["2026-07-13", "2026-07-14"],
      }),
      WITH_UNPAID,
    );

    // The unpaid records are right there in the same card.
    expect(text).toContain("Every unpaid record");
    expect(text).toContain("3.30h");

    // Being ahead on hours is still true and still said.
    expect(text).toMatch(AHEAD_LABEL);
    expect(text).toMatch(AHEAD_CLAIM);
    // …but the card must not deny what it is listing three lines down.
    expect(text).not.toMatch(NOTHING_TO_EXPLAIN);
  });
});

describe("WorkCostCard — float noise", () => {
  it("treats an exactly-even period as even", () => {
    // 8.1 + 8.2 + 8.3 clocked, 24.6 flagged. Two independent float reductions
    // over numeric(5,2) values land 3.55e-15 apart.
    const clocked = 8.1 + 8.2 + 8.3;
    expect(clocked).not.toBe(24.6); // the noise is real, not invented here

    const text = renderCard(
      result({
        status: "ok",
        hourly: 30,
        flagPay: 700,
        totalPay: 738,
        flagHours: 24.6,
        countedFlagHours: 24.6,
        clockedHours: clocked,
        denomHours: clocked,
        denomSource: "clocked",
        workDays: ["2026-07-13", "2026-07-14", "2026-07-15"],
        clockDays: ["2026-07-13", "2026-07-14", "2026-07-15"],
      }),
    );

    expect(text).toMatch(GAP_LABEL);
    expect(text).not.toMatch(AHEAD_LABEL);
    expect(text).not.toMatch(AHEAD_CLAIM);
    expect(text).not.toMatch(NOTHING_TO_EXPLAIN);
  });
});

describe("WorkCostCard — the positive and zero branches are untouched", () => {
  it("labels a positive gap 'Gap' and adds no caption", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 21,
        flagPay: 1200,
        totalPay: 1260,
        flagHours: 40,
        countedFlagHours: 40,
        clockedHours: 60,
        denomHours: 60,
        denomSource: "clocked",
        workDays: ["2026-07-13"],
        clockDays: ["2026-07-13"],
      }),
    );

    expect(text).toContain("Gap20.0h");
    expect(text).not.toMatch(AHEAD_LABEL);
    expect(text).not.toMatch(AHEAD_CLAIM);
    expect(text).not.toMatch(NOTHING_TO_EXPLAIN);
    expect(text).not.toMatch(/more flagged than hours at the shop/i);
  });

  it("keeps a sub-resolution positive gap at '<0.1'", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 25,
        flagPay: 1000,
        totalPay: 1000,
        flagHours: 39.98,
        countedFlagHours: 39.98,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-07-13"],
        clockDays: ["2026-07-13"],
      }),
    );

    expect(text).toContain("Gap<0.1h");
    expect(text).not.toMatch(AHEAD_LABEL);
  });

  it("renders an exact zero gap as 'Gap 0.0h' with no caption", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 25,
        flagPay: 1000,
        totalPay: 1000,
        flagHours: 40,
        countedFlagHours: 40,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-07-13"],
        clockDays: ["2026-07-13"],
      }),
    );

    expect(text).toContain("Gap0.0h");
    expect(text).not.toMatch(AHEAD_LABEL);
    expect(text).not.toMatch(AHEAD_CLAIM);
  });
});
