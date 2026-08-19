// @vitest-environment jsdom
//
// Regression cover for the dashboard half of `zero-efficiency-hero-copy`.
//
// The pay-period hero got the attention because its contradiction was a whole
// sentence. This tile is the tighter version of the same bug: it prints the
// period's flagged hours as its headline and the efficiency underneath, so in
// the hollowed-numerator state it rendered
//
//     36.0h
//     0% efficiency
//
// — two views of one period disagreeing inside a single card, with no room for
// a caption to soften it. Fixing the hero alone left this live.
//
// The tile is fed by rangeStats() in the dashboard page, which returns
// aggregateStatsWithSchedule whenever a schedule exists — so the unpaired*
// fields really do arrive here at runtime. Without that they would be absent,
// the classifier would answer "shown" for everything, and this guard would be
// inert code that reads as protection.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { StatCard } from "./StatCard";

afterEach(cleanup);

// A period whose every flagged hour landed on days the app cannot measure:
// numerator 0 over a denominator built from an unrelated zero-work day.
//
// SCHEDULE-DRIVEN, which is the ordinary case for a tech who has a schedule and
// does not type clock figures: `clockedHours` is 0 because no clock row was
// ever entered, while `denomHours` is the 8.0h the schedule supplied and the
// figure the withheld percentage was divided by.
const HOLLOWED = {
  flagHours: 36,
  clockedHours: 0,
  denomHours: 8,
  denomSource: "scheduled",
  efficiency: 0,
  unpairedFlagHours: 36,
  unpairedDays: 2,
} as const;

// The control: a real, fully-measured 0%. Clocked eight hours, flagged nothing
// on them. Nothing excluded, so the figure means exactly what it says.
const MEASURED_ZERO = {
  flagHours: 0,
  clockedHours: 8,
  efficiency: 0,
  unpairedFlagHours: 0,
  unpairedDays: 0,
} as const;

const PCT = /\d+% efficiency/;

// The hours line the tile falls back to. Same locator for both the withheld
// case and the control, so neither assertion can pass on a stale selector.
const HOURS_LINE = /\d+\.\d+h (clocked|scheduled|clocked \+ scheduled)/;

describe("StatCard", () => {
  it("does not print a percentage when every flagged hour was excluded", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={HOLLOWED as any} />);
    expect(screen.getByText("Pay Period")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(PCT);
  });

  it("falls back to the hours line it already used for a null figure", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={HOLLOWED as any} />);
    expect(screen.getByText(HOURS_LINE)).toBeTruthy();
  });

  // The fallback used to print `clockedHours`, which is 0.0h on any period whose
  // denominator came from the schedule. So withholding the percentage swapped
  // one contradiction for another: "36.0h" over "0.0h clocked", on a period the
  // app measured against 8.0h. PeriodStats.tsx:78-88 documents fixing exactly
  // this for its own Hours tile; the dashboard tile still had it.
  it("prints the denominator it measured against, not the empty clock total", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={HOLLOWED as any} />);
    expect(screen.getByText("8.0h scheduled")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/0\.0h/);
  });

  // No schedule at all: denomHours is absent, so the line falls back to the
  // clock total and keeps the word it always used. Without this the fix above
  // could be a rename that quietly broke the no-schedule tech.
  it("still says 'clocked' when there is no schedule", () => {
    render(
      <StatCard
        label="This Week"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats={{ ...MEASURED_ZERO, efficiency: null } as any}
      />,
    );
    expect(screen.getByText("8.0h clocked")).toBeTruthy();
  });

  it("still prints a genuinely measured 0% — the figure is the point of the tile", () => {
    // The same PCT matcher as the negative assertion above. If the regex or the
    // render ever stops matching, this control goes red instead of the negative
    // silently passing for the wrong reason.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={MEASURED_ZERO as any} />);
    expect(document.body.textContent ?? "").toMatch(PCT);
    expect(document.body.textContent ?? "").toMatch(/0% efficiency/);
    // …and when the percentage IS printed the hours line is not — the same
    // HOURS_LINE locator the withheld assertions above rely on, proving it can
    // both match and fail to match for the right reasons.
    expect(document.body.textContent ?? "").not.toMatch(HOURS_LINE);
  });
});
