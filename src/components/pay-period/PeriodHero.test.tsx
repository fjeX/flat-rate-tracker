// @vitest-environment jsdom
//
// Regression cover for `zero-efficiency-hero-copy`.
//
// The in-progress hero rendered this, as ONE sentence, on 2026-08-18:
//
//     0% efficiency · well ahead of your goal so far
//
// Two clauses from two pipelines that never consult each other. `efficiency` is
// gated per day by pairDay(), so 42.0h sitting on an unscheduled Saturday and a
// still-in-progress today fell out of the numerator entirely; the forecast next
// to it is built from the raw flagged total, so it still saw all 42.0h. Both
// halves computed correctly. Together they told the tech he had produced
// nothing and was well ahead.
//
// It self-resolved the next morning, which is exactly why it needs a test: the
// state is transient and guaranteed to return on the 1st and 16th of every
// month, when most of a period's flagged work is still on open days.
//
// WHY THIS DRIVES THE COMPONENT AND NOT JUST THE PREDICATE:
// lib/efficiency-display has its own unit tests, and they cannot fail on this
// bug — the defect was never in a calculation. It was two correct values
// rendered into one sentence. Only the rendered output can prove they are no
// longer in it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { PeriodHero } from "./PeriodHero";
import type { ProjectionLabel } from "@/lib/period-mode";

// The hero module imports a server action for the awaiting-pay variant. Nothing
// under test calls it; this keeps jsdom from evaluating server-only code.
vi.mock("@/app/actions/paid-periods", () => ({
  setPaidPeriodHoursAction: vi.fn(),
}));

/** The forecast state that produced the contradiction: early, wildly ahead. */
const AHEAD_TOO_EARLY: ProjectionLabel = { kind: "implausible", state: "ahead" };

// Explicit rather than leaning on auto-cleanup: several assertions below read
// document.body wholesale, and a leaked render from the previous test would make
// a "must not appear" assertion fail for the wrong reason.
afterEach(cleanup);

// ONE locator, used by both the "must not appear" and the "must appear" case.
// A negative assertion on a selector nothing ever matches passes for free — the
// control below is what proves this regex can find a percentage at all.
const EFFICIENCY_FIGURE = /\d+% efficiency/;

function support(): HTMLElement {
  const el = document.querySelector(".period-hero-support");
  if (!el) throw new Error("hero has no support line");
  return el as HTMLElement;
}

describe("InProgressHero — a percentage that means nothing is withheld", () => {
  it("never claims 0% and 'well ahead' in the same breath", () => {
    render(
      <PeriodHero.InProgress
        flagHours={42}
        // A genuinely computed 0: numerator 0 over a real denominator, because
        // every flagged hour landed on a day with no measurable length.
        efficiency={0}
        unpairedFlagHours={42}
        unpairedDays={2}
        projection={AHEAD_TOO_EARLY}
      />,
    );

    // The projection is NOT censored — it answers a different question and it
    // is true.
    expect(screen.getByText(/well ahead of your goal so far/)).toBeTruthy();

    // The percentage is gone from the whole hero, not merely moved.
    expect(document.body.textContent).not.toMatch(EFFICIENCY_FIGURE);
    expect(document.body.textContent).not.toMatch(/0%/);

    // And "in the same breath" is pinned structurally, not just by wording:
    // whatever the hero says about efficiency is not on the projection's line.
    expect(support().textContent).not.toMatch(/efficiency/i);

    // Withheld out loud, naming the hours and the day count.
    const note = screen.getByText(/No efficiency yet/);
    expect(note.textContent).toMatch(/42\.0h/);
    expect(note.textContent).toMatch(/2 days/);
  });

  it("says which figure is missing when most — not all — of the work is excluded", () => {
    render(
      <PeriodHero.InProgress
        flagHours={40}
        // 4h over an 8h day = a real 50%, but it describes a tenth of the work.
        efficiency={50}
        unpairedFlagHours={36}
        unpairedDays={1}
        projection={AHEAD_TOO_EARLY}
      />,
    );

    expect(document.body.textContent).not.toMatch(EFFICIENCY_FIGURE);
    const note = screen.getByText(/Efficiency isn't shown/);
    expect(note.textContent).toMatch(/36\.0h/);
    expect(note.textContent).toMatch(/of the 40\.0h/);
    expect(note.textContent).toMatch(/a day/);
  });
});

describe("InProgressHero — the control: a real 0% still shows", () => {
  // THE CASE THAT PROVES THE PREDICATE ISN'T JUST SWALLOWING ZEROS.
  // A tech who clocked 8 hours and flagged nothing has a true, useful and
  // fairly alarming 0%. Keying the withhold on `efficiency === 0` would have
  // erased it — which is why the predicate keys on excluded hours instead.
  it("prints 0% when the zero is fully measured", () => {
    render(
      <PeriodHero.InProgress
        flagHours={0}
        efficiency={0}
        unpairedFlagHours={0}
        unpairedDays={0}
        projection={{ kind: "projected", projected: 12, goal: 45, state: "behind" }}
      />,
    );

    expect(support().textContent).toMatch(EFFICIENCY_FIGURE);
    expect(screen.getByText(/0% efficiency/)).toBeTruthy();
    expect(screen.queryByText(/No efficiency yet/)).toBeNull();
    expect(screen.queryByText(/Efficiency isn't shown/)).toBeNull();
  });

  // The visual-suite fixture shape: one unscheduled Saturday inside a period of
  // otherwise clocked weekdays. A couple of excluded hours must NOT trip the
  // withhold — if they did, every schedule-aware period with a single odd day
  // would lose its percentage.
  it("keeps the percentage when only a small share of the work is excluded", () => {
    render(
      <PeriodHero.InProgress
        flagHours={30.8}
        efficiency={62}
        unpairedFlagHours={2.8}
        unpairedDays={1}
        projection={{ kind: "projected", projected: 44, goal: 45, state: "close" }}
      />,
    );

    expect(support().textContent).toMatch(EFFICIENCY_FIGURE);
    expect(screen.getByText(/62% efficiency/)).toBeTruthy();
  });
});
