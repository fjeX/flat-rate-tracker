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
  openTicketHours: 0,
  openTicketCount: 0,
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

// payperiod-notcounted-caption-reason.
//
// The caption under the grid printed ONE sentence for all four reasons a day
// can go uncounted: "with no clocked hours and no schedule … Clock them or add
// them to your schedule to include them." On three of the five nights this
// escalated, the real reason was a shift still in progress — so the line told
// the tech to fix a day that was not broken. The numbers were never wrong; the
// explanation was.
//
// The in-progress wording is not new: WorkCostCard has printed "that shift is
// still in progress" off wage-check's ongoingDays the whole time, one card
// below. Two sentences for one situation is how this page got here.
describe("PeriodStats — why those hours were not counted", () => {
  const IN_PROGRESS = {
    ...BASE,
    roCount: 1,
    flagHours: 6,
    efficiency: null,
    denomSource: null,
    denomHours: 0,
    unpairedFlagHours: 6,
    unpairedDays: 1,
    unpairedByReason: {
      in_progress: { flagHours: 6, days: 1 },
      day_off: { flagHours: 0, days: 0 },
      unscheduled: { flagHours: 0, days: 0 },
      no_schedule: { flagHours: 0, days: 0 },
    },
  };

  const UNSCHEDULED = {
    ...IN_PROGRESS,
    unpairedByReason: {
      in_progress: { flagHours: 0, days: 0 },
      day_off: { flagHours: 0, days: 0 },
      unscheduled: { flagHours: 6, days: 1 },
      no_schedule: { flagHours: 0, days: 0 },
    },
  };

  // ONE locator per sentence, reused by the positive and negative assertions on
  // both sides, so a broken locator fails loudly instead of passing for free.
  const STILL_RUNNING = /still in progress/;
  // The no_schedule sentence — the ONLY one allowed to say the tech has no
  // schedule. It used to be printed for all three unmeasurable reasons.
  const GO_FIX_IT = /no clocked hours and no work schedule/;

  function withReason(
    reason: "in_progress" | "day_off" | "unscheduled" | "no_schedule",
    flagHours: number,
    days: number,
  ) {
    const empty = { flagHours: 0, days: 0 };
    return {
      ...IN_PROGRESS,
      unpairedFlagHours: flagHours,
      unpairedDays: days,
      unpairedByReason: {
        in_progress: { ...empty },
        day_off: { ...empty },
        unscheduled: { ...empty },
        no_schedule: { ...empty },
        [reason]: { flagHours, days },
      },
    };
  }

  function textFor(stats: ReturnType<typeof withReason>): string {
    render(<PeriodStats stats={stats} hideFlagHours />);
    return document.body.textContent ?? "";
  }

  // THE EXECUTED REPRO: schedule exists, Wed 2026-09-02 marked off, tech came
  // in anyway and flagged 6.5h. The caption told him to add the day to a
  // schedule it was already on.
  it("day off: names the day off and says how to correct it", () => {
    const text = textFor(withReason("day_off", 6.5, 1));
    expect(text).toMatch(/6\.5h/);
    expect(text).toMatch(/marked off on your schedule/);
    expect(text).toMatch(/clear the day off/);
    expect(text).not.toMatch(GO_FIX_IT);
    expect(text).not.toMatch(/add it to your schedule/);
    expect(text).not.toMatch(STILL_RUNNING);
  });

  it("unscheduled: says the schedule has no shift on that day", () => {
    const text = textFor(withReason("unscheduled", 5, 1));
    expect(text).toMatch(/puts no shift on that day/);
    expect(text).toMatch(/add a shift for that day/);
    expect(text).not.toMatch(GO_FIX_IT);
    expect(text).not.toMatch(/marked off/);
  });

  it("no schedule: the one case that says you have no schedule", () => {
    const text = textFor(withReason("no_schedule", 4, 2));
    expect(text).toMatch(GO_FIX_IT);
    expect(text).toMatch(/add them to your schedule/);
    expect(text).not.toMatch(/marked off|puts no shift/);
  });

  // DEFECT 2. PeriodHero's "all excluded" line names the missing hours and
  // deliberately does NOT say where they went — it points at this caption for
  // that. The shared clause had dropped the phrase.
  it("says these hours ARE in the flagged total above", () => {
    for (const reason of ["in_progress", "day_off", "unscheduled", "no_schedule"] as const) {
      document.body.innerHTML = "";
      expect(textFor(withReason(reason, 6, 1))).toMatch(
        /in your flagged total above, but in neither side of the percentage/,
      );
    }
  });

  it("says the shift is still in progress, not that it needs scheduling", () => {
    render(<PeriodStats stats={IN_PROGRESS} hideFlagHours />);

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Not counted above/);
    expect(text).toMatch(STILL_RUNNING);
    // THE BUG: the instruction that sent the tech to fix nothing.
    expect(text).not.toMatch(GO_FIX_IT);
  });

  it("still says to clock it when the day really is unmeasurable", () => {
    render(<PeriodStats stats={UNSCHEDULED} hideFlagHours />);

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Clock it, or add a shift for that day/);
    expect(text).not.toMatch(STILL_RUNNING);
  });

  it("explains both when a period holds both kinds of day", () => {
    render(
      <PeriodStats
        stats={{
          ...IN_PROGRESS,
          unpairedFlagHours: 11,
          unpairedDays: 2,
          unpairedByReason: {
            in_progress: { flagHours: 6, days: 1 },
            day_off: { flagHours: 0, days: 0 },
            unscheduled: { flagHours: 5, days: 1 },
            no_schedule: { flagHours: 0, days: 0 },
          },
        }}
        hideFlagHours
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).toMatch(STILL_RUNNING);
    expect(text).toMatch(/puts no shift on that day/);
    // Each sentence carries its OWN hours, not the period total.
    expect(text).toMatch(/6\.0h/);
    expect(text).toMatch(/5\.0h/);
  });

  it("keeps the original sentence for a stats blob with no breakdown", () => {
    // Snapshots and the no-schedule path carry the flat pair only. Dropping the
    // caption there would hide the excluded hours entirely.
    render(<PeriodStats stats={HOLLOWED} hideFlagHours />);

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Not counted above/);
    expect(text).toMatch(GO_FIX_IT);
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
