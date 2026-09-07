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
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { EffectiveHourly } from "@/lib/wage-check";
import type { UnpaidSummary } from "@/lib/unpaid-summary";

// The card now owns the app's only per-row unpaid-time delete, so it calls a
// server action and asks the router to repaint. Both are mocked; the factories
// reference these fns lazily (inside an arrow) so the hoisted vi.mock cannot
// touch them before they are initialised.
const deleteUnpaidTimeAction = vi.fn();
vi.mock("@/app/actions/unpaid-time", () => ({
  deleteUnpaidTimeAction: (...a: [string]) => deleteUnpaidTimeAction(...a),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

// Imported after the mocks so the component picks them up.
import { WorkCostCard } from "./WorkCostCard";

// The id of the ledger row in WITH_UNPAID. A uuid, because the action validates
// the shape before it reaches the data layer.
const LEDGER_ROW_ID = "aaaaaaaa-0000-4000-8000-000000000001";

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
// What the claim is measured AGAINST, and over WHAT STRETCH — the two things
// round 2 asserted without checking. Both are used as negative assertions
// below, so both are also asserted positively in a state where they must
// match (the "hours complete" control, and the in-progress case for the
// basis).
const AT_THE_SHOP_BASIS = /more than you were at the shop/;
const SETTLED_SCOPE = /at the shop this period/;

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
      id: LEDGER_ROW_ID,
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
    // Defaults to null rather than mirroring totalPay ON PURPOSE. countedPay is
    // the numerator the rate is actually made of; a test that wants the card to
    // print a division has to say what that numerator is, which is the step the
    // ongoing-day tests below used to skip (they set totalPay = hourly x
    // denomHours and so made the wrong field look right).
    countedPay: null,
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
    // CONTROL for the round-3 negatives: a settled period measured at the
    // shop is exactly where both of these must match.
    expect(text).toMatch(AT_THE_SHOP_BASIS);
    expect(text).toMatch(SETTLED_SCOPE);
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

    // The VALUE is fmtHours' business, not the epsilon's, and fmtHours' rule
    // is that a real zero and a rounded-away nonzero must not be the same
    // string. 3.55e-15 is nonzero and negative, so it prints "−<0.1" — the
    // same as HEAD~2. Pinned because the alternative (unsigned) is what made
    // −0.04 and +0.04 identical two tests down; there is no threshold that
    // separates float noise from three real minutes without inventing one.
    expect(text).toContain("Gap−<0.1h");
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

// ─────────────────────────────────────────────────────────────────────────────
// Round 3. The round-2 gate ("missingClockDays is empty and there is SOME
// denominator") is a correct restatement of wage-check's own status, and it is
// the wrong question: it says the denominator COVERS the period, and the
// caption then says the denominator was MEASURED at the shop, over a whole
// period. Two more things decide whether that second sentence is true.
describe("WorkCostCard — the whole denominator came from the schedule", () => {
  // denomSource "scheduled" = zero clock entries; every hour in the
  // denominator is a substituted normal shift. missingClockDays is empty, so
  // the round-2 gate passes and the card said "you were at the shop" about
  // hours nobody observed — one line under its own "your normal scheduled
  // shift was used for them", and beside a tile that already refuses to say
  // "At the shop". A tech who never clocks hits this EVERY period, and
  // wage-check opens by calling missing clock data the norm.
  it("names the schedule as the basis instead of claiming observed shop time", () => {
    const days = [
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ];
    const text = renderCard(
      result({
        status: "ok",
        hourly: 60.5,
        flagPay: 2000,
        totalPay: 2420,
        flagHours: 88.3,
        countedFlagHours: 88.3,
        clockedHours: 0,
        denomHours: 40,
        denomSource: "scheduled",
        workDays: days,
        clockDays: [],
        scheduledDays: days,
      }),
    );

    // The figures are unchanged — this is a wording fix, not a suppression.
    expect(text).toContain("Scheduled40.0h");
    expect(text).toContain("Flagged88.3h");
    expect(text).toContain("Ahead48.3h");
    expect(text).toMatch(AHEAD_LABEL);

    // …and being ahead of your scheduled shift is real information, so the
    // claim survives — against the basis it actually has.
    expect(text).toContain(
      "You flagged 48.3h more than your scheduled hours this period",
    );
    expect(text).toContain("you're ahead of your normal shift.");
    expect(text).toContain("No clock entries were logged");

    // The one thing it must never say: that those were observed shop hours.
    expect(text).not.toMatch(AT_THE_SHOP_BASIS);
  });

  // The BOUNDARY of that rule, and a guard against over-correcting it. "mixed"
  // means part of the denominator is real clock data, and the card already
  // calls mixed "hours at the shop" in the denominator sentence and in the
  // tile label — a predicate of `denomSource === "clocked"` would put the
  // caption at odds with the two lines around it.
  it("keeps the measured wording when only some days came from the schedule", () => {
    const days = [
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ];
    const text = renderCard(
      result({
        status: "ok",
        hourly: 60.5,
        flagPay: 2000,
        totalPay: 2420,
        flagHours: 88.3,
        countedFlagHours: 88.3,
        clockedHours: 32,
        denomHours: 40,
        denomSource: "mixed",
        workDays: days,
        clockDays: days.slice(0, 4),
        scheduledDays: [days[4]],
      }),
    );

    expect(text).toContain("At the shop40.0h");
    expect(text).toMatch(AT_THE_SHOP_BASIS);
    expect(text).toMatch(SETTLED_SCOPE);
    expect(text).not.toContain("No clock entries were logged");
  });
});

describe("WorkCostCard — a shift still in progress", () => {
  // ongoingDays are excluded from BOTH sides, so the comparison covers the
  // days counted so far — not the period. The card asserted a settled
  // period-scope verdict and then, two lines later, said the figure would
  // move. It genuinely reverses: 40 clocked / 50 flagged is "Ahead 10.0h"
  // until the tech clocks a 12h shift that flags nothing, and then it is
  // "Gap 2.0h".
  it("scopes the claim to the days counted rather than the period", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 30,
        flagPay: 1150,
        totalPay: 1200,
        flagHours: 50,
        countedFlagHours: 50,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"],
        clockDays: ["2026-08-17", "2026-08-18", "2026-08-19"],
        ongoingDays: ["2026-08-20"],
      }),
    );

    expect(text).toContain("Ahead10.0h");
    expect(text).toContain("Aug 20 isn't counted yet");

    // Still measured at the shop — the clock data is real. Only the SCOPE was
    // wrong, so this locator must still match.
    expect(text).toMatch(AT_THE_SHOP_BASIS);
    expect(text).toContain(
      "You flagged 10.0h more than you were at the shop on the days counted so far",
    );

    // The settled-period claim is what has to go.
    expect(text).not.toMatch(SETTLED_SCOPE);
    expect(text).not.toMatch(AHEAD_CLAIM);
  });

  // Both at once — a tech on the schedule fallback, mid-period. The two
  // rewordings compose rather than one overwriting the other.
  it("names the schedule AND scopes the days when both apply", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 60.5,
        flagPay: 2000,
        totalPay: 2420,
        flagHours: 95,
        countedFlagHours: 88.3,
        denomHours: 40,
        denomSource: "scheduled",
        workDays: ["2026-07-13", "2026-07-14", "2026-07-20"],
        scheduledDays: ["2026-07-13", "2026-07-14"],
        ongoingDays: ["2026-07-20"],
      }),
    );

    expect(text).toContain(
      "You flagged 48.3h more than your scheduled hours on the days counted so far",
    );
    expect(text).toContain("Jul 20 isn't counted yet");
    expect(text).not.toMatch(AT_THE_SHOP_BASIS);
    expect(text).not.toMatch(SETTLED_SCOPE);
  });
});

describe("WorkCostCard — a sub-resolution gap keeps its direction", () => {
  // Below half a display step the label stays "Gap" (the epsilon that killed
  // the float-noise false positive). Round 2 also dropped the sign there, so
  // 40.0 clocked / 40.04 flagged and 40.0 / 39.96 rendered the SAME string —
  // opposite directions, indistinguishable, on a card whose whole subject is
  // which way the number points.
  const tiny = (flagged: number) =>
    renderCard(
      result({
        status: "ok",
        hourly: 25,
        flagPay: 1000,
        totalPay: 1000,
        flagHours: flagged,
        countedFlagHours: flagged,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-07-13"],
        clockDays: ["2026-07-13"],
      }),
    );

  // The third tile, label and value together — textContent runs them straight
  // into each other, which is the whole reason a bare /Ahead/ is the locator
  // this file uses.
  const gapTile = (text: string) =>
    text.match(/(?:Gap|Ahead|Difference)−?(?:<0\.1|\d+\.\d)h/)?.[0] ??
    "(no gap tile)";

  it("keeps a negative sub-resolution gap distinguishable from a positive one", () => {
    const under = gapTile(tiny(40.04)); // flagged 0.04h MORE than clocked
    const over = gapTile(tiny(39.96)); // flagged 0.04h LESS than clocked

    expect(over).toBe("Gap<0.1h"); // unchanged from HEAD~2
    expect(under).toBe("Gap−<0.1h"); // the direction is back
    expect(under).not.toBe(over);
  });

  // EXACTLY half a display step. This expectation changed with the stored-
  // precision snap in lib/format (fmtHours now sees 40.05 − 40 as a genuine
  // 0.05 rather than 0.04999999999999716), and the card's epsilon gate was
  // moved onto the formatter's answer to match — see the comment on
  // `gapIsSubResolution`.
  //
  // "Gap −<0.1h" is the band's wording for a figure too small to print. 0.05
  // prints: it rounds to 0.1. Keeping the old expectation would have left the
  // label saying "too small to show" beside a number showing ("Gap −0.1h"),
  // which is the one reading that is incoherent rather than merely arguable.
  // This is also continuous with the 40.06 pin below — both sides of the
  // boundary now say the same thing.
  it("flips to 'Ahead' at exactly half a display step, where the value starts printing", () => {
    expect(gapTile(tiny(40.05))).toBe("Ahead0.1h");
  });

  it("flips to 'Ahead' once the gap is big enough to print", () => {
    // Already true at HEAD — a PIN, not a repair. It is the other side of the
    // boundary the two tests above sit on, and it is what stops the sign fix
    // from being applied one step too far (a signed "Ahead−0.1h" would say the
    // direction twice, once in each half of the same tile).
    expect(gapTile(tiny(40.06))).toBe("Ahead0.1h");
  });
});

// ── The division under the headline ──────────────────────────────────────────
//
// Escalation `costcard-total-pay-mismatch`. The sentence beneath the rate is
// presented as the arithmetic that produced it, so it has to BE that
// arithmetic. It printed result.totalPay — the full period, in-progress day
// included — over denomHours, which has no hours for that day. The quotient on
// screen was not the number directly above it.
//
// The two ongoing-day tests further up mock totalPay = hourly × denomHours,
// which is exactly why the suite never caught this: they made the buggy field
// coincidentally correct. These deliberately do not.
describe("WorkCostCard — the arithmetic under the headline", () => {
  const withOngoing = () =>
    renderCard(
      result({
        status: "ok",
        hourly: 30,
        // Fri–Mon counted, Tue still running. Tuesday's flagged work and its
        // spiff are in the period totals and OUT of the rate.
        flagPay: 1400,
        totalPay: 1500,
        countedPay: 1200,
        flagHours: 55,
        countedFlagHours: 44,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"],
        clockDays: ["2026-08-17", "2026-08-18", "2026-08-19"],
        ongoingDays: ["2026-08-20"],
      }),
    );

  it("divides the pay the rate was actually computed from, not the period total", () => {
    const text = withOngoing();
    expect(text).toContain("$1,200 ÷ 40.0 clocked hours");
    // The full-period figure must not appear as the numerator of that sentence.
    expect(text).not.toContain("$1,500 ÷");
  });

  it("prints a division that reproduces the headline rate", () => {
    const text = withOngoing();
    // Pull both sides back out of the DOM and do the division the reader does.
    const m = text.match(/\$([\d,]+) ÷ ([\d.]+) /);
    expect(m).not.toBeNull();
    const numerator = Number(m![1].replace(/,/g, ""));
    const denominator = Number(m![2]);
    expect(numerator / denominator).toBeCloseTo(30, 2);
    // …and 30 is what the headline says.
    expect(text).toContain("$30.00");
  });

  it("says whose pay it is when a shift is still running", () => {
    expect(withOngoing()).toContain("Pay on the days counted $1,200");
  });

  it("still calls it the period total when nothing is in progress", () => {
    const text = renderCard(
      result({
        status: "ok",
        hourly: 30,
        flagPay: 1160,
        totalPay: 1200,
        countedPay: 1200,
        flagHours: 44,
        countedFlagHours: 44,
        clockedHours: 40,
        denomHours: 40,
        denomSource: "clocked",
        workDays: ["2026-08-17"],
        clockDays: ["2026-08-17"],
      }),
    );
    expect(text).toContain("Total pay $1,200 ÷ 40.0 clocked hours");
  });
});

// ── The unpaid audit card's money column ─────────────────────────────────────
//
// Same defect the dispute pack was just fixed for
// (`disputepack-money-column-rounding`), same card that already learned it for
// HOURS: this drill-down itemises every row and then totals them, so a reader
// adds it up. At whole dollars the rows round individually, the total rounds
// separately, and the page contradicts itself while every figure in it is
// individually correct.
describe("WorkCostCard — every unpaid record, money column", () => {
  const priced = (hours: number, dollars: number, i: number) => ({
    source: "ledger" as const,
    id: `00000000-0000-4000-8000-00000000000${i}`,
    date: "2026-07-14",
    kind: "comeback_own" as const,
    hours,
    roNumber: `100${i}`,
    entryId: null,
    code: null,
    description: "rework",
    dollars,
  });

  // 1.40/1.30/1.40/1.10h at $32 — the dispute pack's own case. Whole dollars
  // print 45/42/45/35 = $167 under a total of $166.
  const HOURS = [1.4, 1.3, 1.4, 1.1];
  const RATE = 32;
  const DOLLARS = HOURS.map((h) => h * RATE);
  const TOTAL = DOLLARS.reduce((s, d) => s + d, 0);

  const summary: UnpaidSummary = {
    ...NO_UNPAID,
    lines: HOURS.map((h, i) => priced(h, DOLLARS[i], i)),
    comebackHours: HOURS.reduce((s, h) => s + h, 0),
    totalHours: HOURS.reduce((s, h) => s + h, 0),
    byKind: {
      ...NO_UNPAID.byKind,
      comeback_own: HOURS.reduce((s, h) => s + h, 0),
    },
    totalDollars: TOTAL,
    unpricedHours: 0,
    hasRates: true,
  };

  // The drill-down is a nested disclosure — open it before reading the rows.
  function openRecords(unpaid: UnpaidSummary): string {
    const { container, getByText } = render(
      <WorkCostCard
        result={result({ status: "ok", hourly: 30, denomHours: 40 })}
        referenceRate={null}
        unpaid={unpaid}
        defaultOpen
      />,
    );
    fireEvent.click(getByText("Every unpaid record"));
    return container.textContent ?? "";
  }

  it("prints every row to the cent so the column adds up to its own total", () => {
    const text = openRecords(summary);
    for (const d of DOLLARS) {
      expect(text).toContain(`$${d.toFixed(2)}`);
    }
    expect(text).toContain(`$${TOTAL.toFixed(2)}`);
    // The property, not just the fixture: what a reader sums equals what the
    // total says. Both sides are parsed back out of the rendered DOM.
    // Scoped to the drill-down: the headline rate above it is a dollar figure
    // too, and sweeping it into the column would make this assertion pass or
    // fail for the wrong reason.
    const drill = text.slice(text.indexOf("Every unpaid record"));
    const split = drill.indexOf("Total unpaid");
    expect(split).toBeGreaterThan(0);
    const money = (t: string) =>
      [...t.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) =>
        Number(m[1].replace(/,/g, "")),
      );
    const rows = money(drill.slice(0, split));
    const total = money(drill.slice(split))[0];
    expect(rows).toHaveLength(DOLLARS.length);
    expect(rows.reduce((s, d) => s + d, 0)).toBeCloseTo(total, 2);
    // The whole-dollar rendering that could not reconcile is gone.
    expect(drill).not.toMatch(/\$167(?!\.)/);
  });
});

// ── The explainer has to describe the arithmetic the card performs ───────────
//
// The InfoBubble said "your total pay for the period — flag pay plus spiffs —
// divided by the hours you were actually at the shop". The numerator became
// `countedPay` (escalation `costcard-total-pay-mismatch`); the visible caption
// under the headline was corrected and this paragraph was not, so the card
// explained one division and printed another. Copy that describes a
// computation is part of the computation's contract, and nothing was pinning
// it — the bubble is closed by default, so no rendered-card test ever reached
// it.
describe("WorkCostCard — the explainer matches the maths", () => {
  function openBubble(): string {
    const { container, getByLabelText } = render(
      <WorkCostCard
        result={result()}
        referenceRate={null}
        unpaid={NO_UNPAID}
        defaultOpen
      />,
    );
    fireEvent.click(getByLabelText('What is "What did the work cost me?"?'));
    return container.textContent ?? "";
  }

  it("describes the numerator as the pay on the days counted, not the whole period", () => {
    const text = openBubble();
    // Positive control first: the paragraph is reachable at all.
    expect(text).toMatch(/Effective hourly/);
    expect(text).toMatch(
      /Your pay on the days counted — flag pay plus spiffs — divided by the hours you were at the shop on those same days/,
    );
    // The falsified sentence, gone. Asserted as the exact old wording rather
    // than a loose /total pay/, which still legitimately appears in the
    // headline caption below the rate.
    expect(text).not.toMatch(/Your total pay for the period/);
  });

  it("says an in-progress shift is excluded from both sides", () => {
    const text = openBubble();
    expect(text).toMatch(/A shift still in progress is left out of/);
    expect(text).toMatch(/not in the denominator/);
  });

  // The schedule fill counts days with FLAGGED WORK (pairDay's `flag > 0`),
  // plus confirmed real zeros. A day whose ROs all flagged zero is neither, and
  // the explainer used to imply otherwise by saying only "a day with flagged
  // work on it was obviously a day you worked".
  it("says a day whose ROs all flagged zero is not filled from the schedule", () => {
    const text = openBubble();
    expect(text).toMatch(/all flagged zero hours is not one of those days/);
    expect(text).toMatch(/A day you marked as a real zero counts its whole shift too/);
  });
});

// ── Deleting one unpaid record ───────────────────────────────────────────────
//
// The gap this closes: every unpaid_time row was permanent from the UI. The
// data layer had deleteUnpaidTime with ZERO callers, and the only escape hatch
// in the whole app was Settings' "clear all data", which also destroys every
// RO, spiff, dispute and clock hour the account owns. Meanwhile these rows
// print on the dispute pack — the document a tech hands a service manager — so
// a wrong one costs credibility on every other row beside it.
//
// Three things are pinned here, and they are the three that can hurt someone:
//   1. Nothing is deleted without a confirmation.
//   2. That confirmation NAMES the row — kind, hours, date — so a mis-click on
//      a list of similar-looking rows cannot be silent. A dialog that says
//      "delete this record?" protects nobody.
//   3. The action is called with the row's ID and nothing else. A stored 0.01h
//      spans 18s-54s of hold time, so a real 30s rework and an old pre-gate
//      phantom are the SAME VALUE — a delete phrased over hours destroys real
//      evidence.
describe("WorkCostCard — deleting one unpaid record", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    deleteUnpaidTimeAction.mockReset();
    deleteUnpaidTimeAction.mockResolvedValue({});
    refresh.mockReset();
    // jsdom's window.confirm throws "not implemented". The guard is deliberate
    // product behaviour, so it stays in the component and gets answered here.
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Render the card and open the nested "Every unpaid record" drill-down. */
  function openRecords(unpaid: UnpaidSummary = WITH_UNPAID) {
    render(
      <WorkCostCard
        result={result({
          status: "no_rates",
          flagHours: 40,
          countedFlagHours: 40,
          clockedHours: 48,
          denomHours: 48,
          denomSource: "clocked",
          workDays: ["2026-07-14"],
          clockDays: ["2026-07-14"],
        })}
        referenceRate={null}
        unpaid={unpaid}
        defaultOpen
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Every unpaid record/ }));
  }

  const deleteButtons = () =>
    screen.queryAllByRole("button", { name: /^Delete unpaid record/ });

  it("offers one delete control per ledger row, named by kind, hours and date", () => {
    openRecords();

    const buttons = deleteButtons();
    expect(buttons).toHaveLength(1);
    // The label is what a script or a screen reader SELECTS BY. Generic labels
    // across a list of rows is how the wrong one gets deleted (SpiffsCard,
    // 2026-08-19), so it names the same three facts the dialog does.
    expect(buttons[0].getAttribute("aria-label")).toBe(
      "Delete unpaid record — Waiting on parts, 3.30h, Jul 14, 2026",
    );
  });

  it("asks first, and does not delete when the confirm is declined", () => {
    confirmSpy.mockReturnValue(false);
    openRecords();

    fireEvent.click(deleteButtons()[0]);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteUnpaidTimeAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("names the row in the confirm — kind, hours to 2dp, and the date", () => {
    openRecords();
    fireEvent.click(deleteButtons()[0]);

    const asked = confirmSpy.mock.calls[0][0] as string;

    // The three facts, asserted individually so a reworded sentence that DROPS
    // one still fails.
    expect(asked).toContain("Waiting on parts"); // kind
    expect(asked).toContain("3.30h"); // hours, at the resolution they're stored
    expect(asked).toContain("Jul 14, 2026"); // date
    expect(asked).not.toMatch(/undefined/);
    // And the whole sentence, so the copy is a decision rather than an accident.
    expect(asked).toBe(
      "Delete this unpaid record — Waiting on parts, 3.30h, Jul 14, 2026? " +
        "This can't be undone, and it comes off your unpaid totals and your dispute pack.",
    );
  });

  it("hours are named at 2dp, so the 0.01h rows are not all 'the 0.0h one'", () => {
    // The band the safety warning is about: 0.01h could be a phantom or a real
    // 30-54s comeback. At the card's usual 1dp the dialog would say "0.0h" for
    // every one of them, which names nothing.
    openRecords({
      ...NO_UNPAID,
      lines: [
        {
          source: "ledger",
          id: LEDGER_ROW_ID,
          date: "2026-07-14",
          kind: "comeback_own",
          hours: 0.01,
          roNumber: null,
          entryId: null,
          code: null,
          description: "",
          dollars: null,
        },
      ],
      comebackHours: 0.01,
      totalHours: 0.01,
      byKind: { ...NO_UNPAID.byKind, comeback_own: 0.01 },
      unpricedHours: 0.01,
    });

    fireEvent.click(deleteButtons()[0]);
    expect(confirmSpy.mock.calls[0][0]).toContain("0.01h");
  });

  it("deletes by primary key — the id, and nothing else", async () => {
    openRecords();
    fireEvent.click(deleteButtons()[0]);

    expect(deleteUnpaidTimeAction).toHaveBeenCalledTimes(1);
    expect(deleteUnpaidTimeAction).toHaveBeenCalledWith(LEDGER_ROW_ID);
    // Pinned as the WHOLE argument list. Hours, date and kind must never be
    // part of how a row is identified for deletion.
    expect(deleteUnpaidTimeAction.mock.calls[0]).toEqual([LEDGER_ROW_ID]);
  });

  it("offers no delete control for an RO-side line — that row lives on the RO", () => {
    openRecords({
      ...NO_UNPAID,
      lines: [
        {
          source: "ro",
          id: null,
          date: "2026-07-14",
          kind: "comeback_own",
          hours: 2.5,
          roNumber: "40381",
          entryId: "entry-1",
          code: "BRK-FR",
          description: "Pads only",
          dollars: null,
        },
      ],
      comebackHours: 2.5,
      totalHours: 2.5,
      byKind: { ...NO_UNPAID.byKind, comeback_own: 2.5 },
      unpricedHours: 2.5,
    });

    // The row itself is rendered — this is not a vacuous "nothing is here".
    expect(screen.getByText(/Pads only/)).toBeTruthy();
    expect(deleteButtons()).toHaveLength(0);
  });

  it("reports a delete the server refused instead of pretending it worked", async () => {
    deleteUnpaidTimeAction.mockResolvedValue({ error: "That record is no longer there." });
    openRecords();

    fireEvent.click(deleteButtons()[0]);
    await Promise.resolve();
    await Promise.resolve();

    expect(window.alert).toHaveBeenCalledWith("That record is no longer there.");
    // A failed delete must not repaint as if it succeeded.
    expect(refresh).not.toHaveBeenCalled();
  });
});
