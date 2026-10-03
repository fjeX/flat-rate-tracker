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
