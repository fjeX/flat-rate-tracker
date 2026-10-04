// @vitest-environment jsdom
//
// The "Show as table" twin: the same bars as a ruled table, collapsed until
// asked for. Pins that the toggle is a real disclosure button, that rows match
// the bars (labels, hours, RO counts, order), and that the picked bar is
// mirrored with words as well as the aria state.
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { Entry } from "@/lib/types";
import { HistoryBarChart } from "./HistoryBarChart";

afterEach(cleanup);

function entry(id: string, date: string, flagHours: number): Entry {
  return { id, date, flagHours, roNumber: id, opCodes: [], notes: "" } as unknown as Entry;
}

const ENTRIES = [
  entry("a", "2026-03-09", 2.5),
  entry("b", "2026-03-09", 1),
  entry("c", "2026-03-12", 4),
];

function chart(props: Partial<React.ComponentProps<typeof HistoryBarChart>> = {}) {
  return (
    <HistoryBarChart
      entries={ENTRIES}
      filter="week"
      today="2026-03-12"
      weekStart="2026-03-09"
      weekEnd="2026-03-15"
      splitDay={15}
      selected={null}
      onSelect={() => {}}
      {...props}
    />
  );
}

describe("History chart table twin", () => {
  it("is collapsed by default and the toggle shows and hides the table", () => {
    render(chart());
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(toggle);
    const open = screen.getByRole("button", { name: "Hide table" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.getAttribute("aria-controls")).toBe(document.querySelector("table")!.parentElement!.id);
    expect(screen.getByRole("table")).toBeTruthy();

    fireEvent.click(open);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("has one row per bar, in bar order, with matching hours and RO counts", () => {
    render(chart());
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const body = screen.getByRole("table").querySelector("tbody")!;
    const rows = within(body).getAllByRole("row");
    expect(rows).toHaveLength(7);

    const cells = (i: number) => within(rows[i]).getAllByRole("cell").map((c) => c.textContent);
    const label = (i: number) => within(rows[i]).getByRole("rowheader").textContent ?? "";
    expect(label(0)).toContain("Mon, Mar 9");
    expect(cells(0)).toEqual(["3.5", "2"]);
    expect(label(3)).toContain("Thu, Mar 12");
    expect(cells(3)).toEqual(["4.0", "1"]);
    expect(cells(1)).toEqual(["0.0", "0"]);

    const foot = screen.getByRole("table").querySelector("tfoot")!;
    expect(within(foot).getAllByRole("cell").map((c) => c.textContent)).toEqual(["7.5", "3"]);
  });

  it("mirrors the picked bar and picks through the row label", () => {
    const onSelect = vi.fn();
    render(
      chart({
        onSelect,
        selected: { start: "2026-03-09", end: "2026-03-09", label: "Mon, Mar 9" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = within(screen.getByRole("table").querySelector("tbody")!).getAllByRole("row");

    expect(rows[0].getAttribute("aria-current")).toBe("true");
    expect(rows[0].textContent).toContain("picked");
    expect(rows[1].getAttribute("aria-current")).toBeNull();

    const pressed = within(rows[0]).getByRole("button");
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pressed); // the picked one again clears it
    expect(onSelect).toHaveBeenLastCalledWith(null);

    fireEvent.click(within(rows[3]).getByRole("button"));
    expect(onSelect).toHaveBeenLastCalledWith({
      start: "2026-03-12",
      end: "2026-03-12",
      label: "Thu, Mar 12",
    });
  });

  it("marks the current bar's row with words, not just the accent", () => {
    render(chart());
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = within(screen.getByRole("table").querySelector("tbody")!).getAllByRole("row");
    expect(rows[3].textContent).toContain("now");
  });

  it("shows plain labels, not buttons, when nothing can pick a bar", () => {
    render(chart({ onSelect: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const body = screen.getByRole("table").querySelector("tbody")!;
    expect(within(body).queryAllByRole("button")).toHaveLength(0);
  });
});

// Efficiency is a measurement on every bar, not only a day: a pay period, a
// week or a month reads its counted days' flag over their denominators.
describe("History chart efficiency on every bar", () => {
  const denom = {
    "2026-03-09": { hours: 5, source: "clocked" as const },
    "2026-03-12": { hours: 4, source: "scheduled" as const },
  };

  it("shows a pay period bar's efficiency in the readout", () => {
    render(chart({ filter: "period", denomByDay: denom }));
    // Mar 1–15 is current: (2.5 + 1 + 4) / (5 + 4) = 83%
    const headline = document.querySelector(".chart-headline")!;
    expect(headline.textContent).toContain("83% efficiency");
    expect(headline.querySelector(".r-readout-eff")!.getAttribute("title")).toMatch(
      /clocked hours, and scheduled hours/,
    );
  });

  it("shows a month bar's efficiency in the readout", () => {
    render(chart({ filter: "month", denomByDay: denom }));
    expect(document.querySelector(".chart-headline")!.textContent).toContain("83% efficiency");
  });

  it("adds an Efficiency column to the table twin, with a total", () => {
    render(chart({ filter: "week", denomByDay: denom }));
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Efficiency" })).toBeTruthy();
    const rows = within(table).getAllByRole("row");
    const mon = rows.find((r) => r.textContent?.includes("Mar 9"))!;
    expect(mon.textContent).toContain("70%"); // 3.5 / 5
    const tue = rows.find((r) => r.textContent?.includes("Mar 10"))!;
    expect(tue.textContent).toContain("—"); // nothing counted that day
    const total = rows[rows.length - 1];
    expect(total.textContent).toContain("83%");
  });

  it("guest (no denominators): no efficiency anywhere", () => {
    render(chart({ filter: "period" }));
    expect(document.querySelector(".r-readout-eff")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.queryByRole("columnheader", { name: "Efficiency" })).toBeNull();
  });
});

// "4th best week of 31": rank by the readout's own spanEfficiency figure, among
// finished bars that have one.
describe("History chart bar rank sentence", () => {
  // Days Mar 9-11 are over (100%, 75%, 50%); Mar 12 is today (current, in progress).
  const rows = [
    entry("a", "2026-03-09", 8),
    entry("b", "2026-03-10", 6),
    entry("c", "2026-03-11", 4),
    entry("d", "2026-03-12", 8),
  ];
  const denom = (days: string[]) =>
    Object.fromEntries(days.map((d) => [d, { hours: 8, source: "clocked" as const }]));
  const pick = (d: string) => ({ start: d, end: d, label: d });
  const sentence = () => document.querySelector(".chart-spread")?.textContent ?? null;

  it("ranks the picked bar among finished bars that have an efficiency", () => {
    render(
      chart({
        entries: rows,
        denomByDay: denom(["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12"]),
        selected: pick("2026-03-10"),
      }),
    );
    // Pool: Mar 9 100%, Mar 10 75%, Mar 11 50% (today is excluded).
    expect(sentence()).toBe("2nd highest efficiency of 3 days");
  });

  it("does not rank the in-progress bar", () => {
    render(
      chart({
        entries: rows,
        denomByDay: denom(["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12"]),
        selected: pick("2026-03-12"),
      }),
    );
    expect(sentence()).toBeNull();
  });

  it("says nothing with fewer than 3 rankable bars (null efficiency is not ranked)", () => {
    render(
      chart({
        entries: rows,
        denomByDay: denom(["2026-03-09", "2026-03-10"]),
        selected: pick("2026-03-10"),
      }),
    );
    expect(sentence()).toBeNull();
  });

  it("names the window on a pay-period tab", () => {
    // Three finished pay periods inside the 90-day window, each 8 flag / 8 denom.. 4 / 8.. 2 / 8.
    const periods = [
      entry("p1", "2026-01-05", 8),
      entry("p2", "2026-01-20", 4),
      entry("p3", "2026-02-05", 2),
      entry("p4", "2026-02-20", 1),
    ];
    render(
      chart({
        entries: periods,
        filter: "period",
        today: "2026-03-12",
        denomByDay: denom(["2026-01-05", "2026-01-20", "2026-02-05", "2026-02-20"]),
        selected: { start: "2026-01-16", end: "2026-01-31", label: "Jan 16 – 31" },
      }),
    );
    expect(sentence()).toBe("2nd highest efficiency of 4 pay periods, last 90d");
  });
});

// Escalation `history-bar-efficiency-ungated` (2026-10-04): a bar whose flag
// hours mostly sit on days with no hours to measure them against must not print
// a percentage — the same refusal /pay-period makes — and must not be ranked.
describe("History chart withholds efficiency like Pay Period", () => {
  const clocked = (h: number) => ({ hours: h, source: "clocked" as const });
  // Pay periods: Jan 1-15 (fully measured 8/8 = 100%), Jan 16-31 (fully
  // measured 4/8 = 50%), Feb 1-15 (fully measured 2/8 = 25%), Feb 16-28 (1 of
  // 11 measured: 10h more sits on a day with no denominator -> withheld),
  // and Mar 1-15 is current.
  const rows = [
    entry("p1", "2026-01-05", 8),
    entry("p2", "2026-01-20", 4),
    entry("p3", "2026-02-05", 2),
    entry("p4", "2026-02-17", 1),
    entry("p5", "2026-02-18", 10), // no denominator that day
  ];
  const denom = {
    "2026-01-05": clocked(8),
    "2026-01-20": clocked(8),
    "2026-02-05": clocked(8),
    "2026-02-17": clocked(8),
  };
  const pickWithheld = { start: "2026-02-16", end: "2026-02-28", label: "Feb 16 – 28" };
  const props = {
    entries: rows,
    filter: "period" as const,
    today: "2026-03-12",
    denomByDay: denom,
  };
  const headline = () => document.querySelector(".chart-headline")!.textContent ?? "";
  const sentence = () => document.querySelector(".chart-spread")?.textContent ?? null;

  it("readout: no percentage, a short not-counted note naming hours and days", () => {
    render(chart({ ...props, selected: pickWithheld }));
    expect(headline()).not.toMatch(/\d+% efficiency/);
    expect(headline()).toContain("Not counted: 10.0h on a day with no hours to measure");
  });

  it("table: the row and the TOTAL both read an em dash, not a percentage", () => {
    // Window the table to the withheld period alone via a custom day range.
    render(
      chart({
        entries: rows,
        filter: "custom",
        today: "2026-03-12",
        customRange: { start: "2026-02-16", end: "2026-02-22" },
        denomByDay: denom,
        selected: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const table = screen.getByRole("table");
    const rowsEls = within(table).getAllByRole("row");
    const total = rowsEls[rowsEls.length - 1];
    // 1h counted of 11h flagged -> withheld; ungated this printed 13%.
    expect(total.textContent).toContain("11.0");
    expect(total.textContent).not.toMatch(/%/);
    expect(total.textContent?.trim().endsWith("—")).toBe(true);
    const d17 = rowsEls.find((r) => r.textContent?.includes("Feb 17"))!;
    expect(d17.textContent).toContain("13%"); // that single day is fully measured
  });

  it("period table row is an em dash while measured periods keep their percentage", () => {
    render(chart({ ...props, selected: null }));
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const trs = within(screen.getByRole("table")).getAllByRole("row");
    const jan1 = trs.find((r) => r.textContent?.includes("Jan 1 – Jan 15"))!;
    expect(jan1.textContent).toContain("100%");
    const feb16 = trs.find((r) => r.textContent?.includes("Feb 16 – Feb 28"))!;
    expect(feb16.textContent).not.toMatch(/%/);
    expect(feb16.textContent?.trim().endsWith("—")).toBe(true);
  });

  it("a fully measured period prints the same percentage as before", () => {
    render(
      chart({
        ...props,
        selected: { start: "2026-01-01", end: "2026-01-15", label: "Jan 1 – 15" },
      }),
    );
    expect(headline()).toContain("100% efficiency");
    expect(headline()).not.toContain("Not counted");
  });

  it("ranking leaves withheld bars out of the pool, so N shrinks", () => {
    // Four finished periods, one withheld -> pool of 3, not 4.
    render(
      chart({
        ...props,
        selected: { start: "2026-01-16", end: "2026-01-31", label: "Jan 16 – 31" },
      }),
    );
    expect(sentence()).toBe("2nd highest efficiency of 3 pay periods, last 90d");
  });

  it("a withheld bar itself gets no rank sentence", () => {
    render(chart({ ...props, selected: pickWithheld }));
    expect(sentence()).toBeNull();
  });
});
