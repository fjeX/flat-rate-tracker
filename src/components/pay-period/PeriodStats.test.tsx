// @vitest-environment jsdom
//
// Regression cover for the escalated half of `zero-efficiency-hero-copy`.
//
// The first round of this fix gated the hero. It did NOT gate the stat grid
// rendered as the hero's SIBLING inside the same `.pp-band`, so on 2026-08-19
// the pay-period header band said both of these at once, one element apart:
//
//     No efficiency yet — all 42.0h flagged so far landed on 2 days with
//     no hours to measure them against.
//     ROs 2   Hours · sched 8.0h   Efficiency · sched 0%
//
// A surface that withholds a figure while the tile beside it prints that exact
// figure is worse than one that never withheld it — it reads as the app
// disagreeing with itself, and the tech believes the number, because a number
// beats a sentence.
//
// WHY THE THIRD DESCRIBE BLOCK RENDERS BOTH COMPONENTS TOGETHER:
// each component in isolation was individually defensible. The bug only exists
// in the band, so the band is what the test asserts on. This is the one
// assertion that would have caught what shipped.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { PeriodStats } from "./PeriodStats";
import { PeriodHero } from "./PeriodHero";
import type { ProjectionLabel } from "@/lib/period-mode";

// The hero module imports a server action for its awaiting-pay variant. Nothing
// under test calls it; this keeps jsdom from evaluating server-only code.
vi.mock("@/app/actions/paid-periods", () => ({
  setPaidPeriodHoursAction: vi.fn(),
}));

afterEach(cleanup);

// ONE locator for every assertion below, positive and negative alike. A
// "no percentage appears" assertion written against a regex that matches
// nothing passes for free — the control cases reuse this exact constant so a
// broken locator goes red loudly instead of green quietly
// (memory/feedback_negative_assertions_go_vacuous.md).
const ANY_PCT = /\d+%/;

const BASE = {
  clockedHours: 0,
  actualHours: 0,
  unpaidHours: 0,
  comebackHours: 0,
  waitingHours: 0,
  shopHours: 0,
  upsellHours: 0,
};

// The escalated period, exactly: 42.0h flagged across an unscheduled Saturday
// and a still-open today, divided by one 8.0h scheduled day that had no flagged
// work on it. Numerator 0, denominator 8 → a genuinely computed 0%.
const HOLLOWED = {
  ...BASE,
  roCount: 2,
  flagHours: 42,
  efficiency: 0,
  denomSource: "scheduled" as const,
  denomHours: 8,
  unpairedFlagHours: 42,
  unpairedDays: 2,
};

// The control: same shape, nothing excluded. 42.0h over 32.0h of scheduled
// days = 131%, and that figure is the whole point of the tile.
const MEASURED = {
  ...BASE,
  roCount: 2,
  flagHours: 42,
  efficiency: 131.25,
  denomSource: "scheduled" as const,
  denomHours: 32,
  unpairedFlagHours: 0,
  unpairedDays: 0,
};

// A small share excluded — 2.8h of 30.8h, well under the withhold threshold.
// This is the ordinary schedule-aware period, and it must keep its percentage.
const MOSTLY_MEASURED = {
  ...BASE,
  roCount: 6,
  flagHours: 30.8,
  efficiency: 62,
  denomSource: "clocked" as const,
  denomHours: 45,
  unpairedFlagHours: 2.8,
  unpairedDays: 1,
};

const AHEAD_TOO_EARLY: ProjectionLabel = { kind: "implausible", state: "ahead" };

function effTile(): HTMLElement {
  const label = screen.getByText(/^Efficiency/);
  const tile = label.parentElement;
  if (!tile) throw new Error("efficiency tile has no container");
  return tile as HTMLElement;
}

describe("PeriodStats — the efficiency tile", () => {
  it("prints no percentage when every flagged hour was excluded", () => {
    render(<PeriodStats stats={HOLLOWED} hideFlagHours />);

    expect(effTile().textContent).not.toMatch(ANY_PCT);
    // The em dash the grid already uses for an absent figure, not a blank.
    expect(effTile().textContent).toMatch(/—/);
  });

  it("keeps the rest of the grid intact — only the percentage is withheld", () => {
    render(<PeriodStats stats={HOLLOWED} hideFlagHours />);

    expect(screen.getByText("ROs")).toBeTruthy();
    expect(screen.getByText("Hours · sched")).toBeTruthy();
    // The denominator tile still states the 8.0h it measured against, so the
    // dash beside it reads as "no ratio", not as "no data".
    expect(screen.getByText("8.0h")).toBeTruthy();
    // And the caption still explains it, unchanged.
    expect(screen.getByText(/Not counted above/)).toBeTruthy();
  });

  it("prints the percentage when the figure is genuinely measured", () => {
    // Same ANY_PCT locator as the negative above. If this control ever stops
    // matching, the negative assertion is no longer proving anything.
    render(<PeriodStats stats={MEASURED} hideFlagHours />);

    expect(effTile().textContent).toMatch(ANY_PCT);
    expect(effTile().textContent).toMatch(/131%/);
  });

  it("keeps the percentage when only a small share was excluded", () => {
    render(<PeriodStats stats={MOSTLY_MEASURED} hideFlagHours />);

    expect(effTile().textContent).toMatch(ANY_PCT);
    expect(effTile().textContent).toMatch(/62%/);
    // The caption fires on ANY unpaired hours, so it is a strict superset of
    // the withheld state — which is why the tile does not need its own copy.
    expect(screen.getByText(/Not counted above/)).toBeTruthy();
  });
});

describe("the pay-period header band — hero and stats together", () => {
  // Exactly how PayPeriodView composes them: siblings inside one `.pp-band`.
  function Band({ stats }: { stats: typeof HOLLOWED }) {
    return (
      <div className="pp-band">
        <PeriodHero.InProgress
          flagHours={stats.flagHours}
          efficiency={stats.efficiency}
          unpairedFlagHours={stats.unpairedFlagHours}
          unpairedDays={stats.unpairedDays}
          projection={AHEAD_TOO_EARLY}
        />
        <PeriodStats stats={stats} hideFlagHours />
      </div>
    );
  }

  function band(): HTMLElement {
    const el = document.querySelector(".pp-band");
    if (!el) throw new Error("no band rendered");
    return el as HTMLElement;
  }

  it("never withholds the figure and prints it in the same band", () => {
    render(<Band stats={HOLLOWED} />);

    const text = band().textContent ?? "";
    // The withheld phrase is present…
    expect(text).toMatch(/No efficiency yet/);
    // …and therefore no percentage may be anywhere in the band. THE BUG.
    expect(text).not.toMatch(ANY_PCT);
  });

  it("prints the figure — and no withheld phrase — when it is measurable", () => {
    render(<Band stats={MEASURED} />);

    const text = band().textContent ?? "";
    expect(text).toMatch(ANY_PCT);
    expect(text).toMatch(/131%/);
    expect(text).not.toMatch(/No efficiency yet/);
    expect(text).not.toMatch(/Efficiency isn't shown/);
  });
});
