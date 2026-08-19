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
const HOLLOWED = {
  flagHours: 36,
  clockedHours: 0,
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

describe("StatCard", () => {
  it("does not print a percentage when every flagged hour was excluded", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={HOLLOWED as any} />);
    expect(screen.getByText("Pay Period")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(PCT);
  });

  it("falls back to the clocked-hours line it already used for a null figure", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={HOLLOWED as any} />);
    expect(screen.getByText(/clocked/)).toBeTruthy();
  });

  it("still prints a genuinely measured 0% — the figure is the point of the tile", () => {
    // The same PCT matcher as the negative assertion above. If the regex or the
    // render ever stops matching, this control goes red instead of the negative
    // silently passing for the wrong reason.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={MEASURED_ZERO as any} />);
    expect(document.body.textContent ?? "").toMatch(PCT);
    expect(document.body.textContent ?? "").toMatch(/0% efficiency/);
  });
});
