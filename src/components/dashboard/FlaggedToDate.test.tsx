// @vitest-environment jsdom
//
// The Flagged to date table replaced the dashboard's three StatCard tiles
// (StatCard is gone). What its tests pinned was a set of hard-won behaviours,
// and the dashboard's copy of the same logic has to keep every one of them:
//
//   - `zero-efficiency-hero-copy`: when the period's percentage would be hollow
//     (every flagged hour sat on a day the app can't measure) the row must not
//     print "0%" next to "36.0h". It falls back to the hours it measured
//     against, named the way /pay-period names them.
//   - that fallback is the DENOMINATOR, not the raw clock rows ("0.0h clocked"
//     under a schedule-driven period would swap one contradiction for another).
//   - a genuinely measured 0% still prints. The figure is the point of the row.
//   - open-ticket hours are attribution beside the flag, never in it.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { FlaggedToDate, type SpanStats } from "./FlaggedToDate";

afterEach(cleanup);

const BASE = {
  flagHours: 0,
  clockedHours: 0,
  efficiency: null,
  roCount: 0,
  actualHours: 0,
  unpaidHours: 0,
  comebackHours: 0,
  waitingHours: 0,
  shopHours: 0,
  upsellHours: 0,
  openTicketHours: 0,
  openTicketCount: 0,
} as unknown as SpanStats;

const QUIET: SpanStats = { ...BASE };

// Every flagged hour landed on days the app cannot measure: numerator 0 over a
// denominator built from an unrelated zero-work day. Schedule-driven, so
// clockedHours is 0 while denomHours is the 8.0h the schedule supplied.
const HOLLOWED = {
  ...BASE,
  flagHours: 36,
  clockedHours: 0,
  denomHours: 8,
  denomSource: "scheduled",
  efficiency: 0,
  unpairedFlagHours: 36,
  unpairedDays: 2,
} as SpanStats;

// The control: a real, fully-measured 0%. Clocked eight hours, flagged nothing.
const MEASURED_ZERO = {
  ...BASE,
  flagHours: 0,
  clockedHours: 8,
  efficiency: 0,
  unpairedFlagHours: 0,
  unpairedDays: 0,
} as SpanStats;

/** The efficiency cell of the Pay Period row (second body row). */
function periodCell(): Element {
  const cell = document.querySelectorAll("tbody tr:nth-child(2) td")[1];
  if (!cell) throw new Error("no efficiency cell rendered");
  return cell;
}

function renderTable(period: SpanStats, earnings: string | null = null) {
  return render(<FlaggedToDate week={QUIET} period={period} month={QUIET} earnings={earnings} />);
}

describe("Flagged to date", () => {
  it("lists the three spans in order", () => {
    renderTable(QUIET);
    const heads = Array.from(document.querySelectorAll("tbody th")).map((th) => th.textContent);
    expect(heads).toEqual(["This Week", "Pay Period", "This Month"]);
  });

  it("does not print a percentage when every flagged hour was excluded", () => {
    renderTable(HOLLOWED);
    expect(periodCell().textContent).not.toMatch(/%/);
  });

  it("prints the denominator it measured against, not the empty clock total", () => {
    renderTable(HOLLOWED);
    expect(periodCell().textContent).toBe("8.0h scheduled");
    expect(periodCell().textContent).not.toMatch(/0\.0h/);
  });

  it("still says 'clocked' when there is no schedule", () => {
    renderTable({ ...MEASURED_ZERO, efficiency: null } as SpanStats);
    expect(periodCell().textContent).toBe("8.0h clocked");
  });

  it("still prints a genuinely measured 0%", () => {
    renderTable(MEASURED_ZERO);
    expect(periodCell().textContent).toBe("0%");
  });

  it("colours the percentage by state and only by state", () => {
    renderTable({ ...MEASURED_ZERO, flagHours: 9, efficiency: 112 } as SpanStats);
    expect(periodCell().className).toContain("is-good");
    cleanup();
    renderTable({ ...MEASURED_ZERO, efficiency: 53 } as SpanStats);
    expect(periodCell().className).toContain("is-bad");
    cleanup();
    // The middle band is a plain figure, never an amber one.
    renderTable({ ...MEASURED_ZERO, efficiency: 88 } as SpanStats);
    expect(periodCell().className).not.toContain("is-good");
    expect(periodCell().className).not.toContain("is-bad");
  });

  it("puts open-ticket hours beside the flag, in a line of their own", () => {
    renderTable({ ...QUIET, openTicketHours: 2, openTicketCount: 1 } as SpanStats);
    const line = document.querySelector('[data-testid="open-ticket-line"]');
    expect(line?.textContent).toBe("2.0h on 1 open ticket");
    expect(document.querySelectorAll('[data-testid="open-ticket-line"]').length).toBe(1);
  });

  it("pluralises open tickets", () => {
    renderTable({ ...QUIET, openTicketHours: 5, openTicketCount: 2 } as SpanStats);
    expect(document.querySelector('[data-testid="open-ticket-line"]')?.textContent).toBe(
      "5.0h on 2 open tickets",
    );
  });

  it("shows period earnings only when a rate is priced", () => {
    renderTable(QUIET, "$1,268");
    expect(document.body.textContent).toContain("Period earnings");
    expect(document.body.textContent).toContain("$1,268");
    cleanup();
    renderTable(QUIET, null);
    expect(document.body.textContent).not.toContain("Period earnings");
  });
});
