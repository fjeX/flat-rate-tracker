// @vitest-environment jsdom
//
// Avg mode's honesty line: the sample size and range behind an average, built
// from the same worked-day set the average divides by.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Entry } from "@/lib/types";
import { AveragesChart } from "./AveragesChart";

afterEach(cleanup);

function ro(id: string, date: string, flagHours: number): Entry {
  return { id, date, flagHours, roNumber: id, opCodes: [], notes: "" } as unknown as Entry;
}

function chart(entries: Entry[]) {
  return render(
    <AveragesChart
      entries={entries}
      today="2026-03-12"
      periodStart="2026-03-01"
      periodEnd="2026-03-15"
      weekStart="2026-03-09"
      weekEnd="2026-03-15"
      monthStart="2026-03-01"
      monthEnd="2026-03-31"
      weekStartDay={1}
      splitDay={15}
    />,
  );
}

const spread = () => document.querySelector(".chart-spread")?.textContent ?? null;
// Week tab bars run Mon..Sun, so the first hit target is Monday.
const hoverBar = (i: number) =>
  fireEvent.mouseEnter(document.querySelectorAll(".chart-hit > span")[i]);
const goAvg = () => fireEvent.click(screen.getByRole("button", { name: "Avg" }));

describe("AveragesChart avg readout", () => {
  // Mondays: Mar 2, Feb 23, Feb 16, Feb 9 (all inside the 90-day window).
  const mondays = [
    ro("a", "2026-03-02", 3.1),
    ro("b", "2026-02-23", 11.2),
    ro("c", "2026-02-16", 7),
    ro("d", "2026-02-09", 8.3),
  ];

  it("shows n and range beside a weekday's average", () => {
    chart(mondays);
    goAvg();
    hoverBar(0);
    expect(spread()).toBe("n=4 Mondays · range 3.1–11.2h");
  });

  it("is not shown in Total mode", () => {
    chart(mondays);
    hoverBar(0);
    expect(spread()).toBeNull();
  });

  it("says so plainly when the sample is small", () => {
    chart(mondays.slice(0, 2));
    goAvg();
    hoverBar(0);
    expect(spread()).toBe("n=2 Mondays · range 3.1–11.2h · small sample, take it loosely");
  });

  it("does not hide an empty weekday", () => {
    chart(mondays);
    goAvg();
    hoverBar(1); // Tuesday: never worked
    expect(spread()).toContain("n=0 Tuesdays");
  });

  it("counts worked days on the period tab", () => {
    chart([ro("a", "2026-03-02", 4), ro("b", "2026-03-03", 6), ro("c", "2026-03-04", 8), ro("d", "2026-03-05", 10)]);
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    goAvg();
    hoverBar(0);
    // First bar is the oldest period in the window; walk to the one with data.
    const bars = document.querySelectorAll(".chart-hit > span");
    for (let i = 0; i < bars.length; i++) {
      hoverBar(i);
      if (spread()?.includes("n=4")) {
        expect(spread()).toBe("n=4 worked days · range 4.0–10.0h");
        return;
      }
    }
    throw new Error("no period bar showed n=4");
  });
});
