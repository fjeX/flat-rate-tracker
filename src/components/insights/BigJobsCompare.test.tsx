// @vitest-environment jsdom
//
// Big jobs: the you-vs-book bars, the reason line and n=/range. Rendered through
// the REAL chain — entries -> bigJobPerformance/bigJobCoverage -> BigJobsSection
// — so a bar that stops being wired to the row fails here instead of passing on
// a hand-built props object.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { BIG_JOBS_COLLAPSED, BigJobsSection } from "./JobTimeSections";
import { strongestDaySub } from "./InsightsView";
import { bigJobCoverage, bigJobPerformance } from "@/lib/insights";
import type { Entry, EntryOpCode } from "@/lib/types";

afterEach(cleanup);

function mk(id: string, code: string, flag: number, actual: number | null): Entry {
  const l: EntryOpCode = {
    id,
    opCodeId: null,
    custom: true,
    customCode: code,
    customDescription: null,
    flagHours: flag,
    actualHours: actual,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
  };
  return {
    id,
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-06",
    roNumber: id,
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [l],
    flagHours: flag,
    notes: "",
  };
}

function renderBig(entries: Entry[]) {
  return render(
    <BigJobsSection
      rows={bigJobPerformance(entries, [])}
      coverage={bigJobCoverage(entries)}
    />,
  );
}

describe("BigJobsSection compare bars", () => {
  const entries = [
    // ENGINE: 3 timed, 0.8 / 1.0 / 1.4 -> confident, over book, one long one
    mk("e1", "ENGINE", 5, 4),
    mk("e2", "ENGINE", 5, 5),
    mk("e3", "ENGINE", 5, 7),
    // TRANS: 1 timed -> provisional
    mk("t1", "TRANS", 4, 3),
  ];

  it("draws two bars on one scale, accent for you and ink for the book", () => {
    const { container } = renderBig(entries);
    const bars = container.querySelectorAll(".ins-cmp");
    expect(bars).toHaveLength(2);
    for (const b of bars) {
      expect(b.getAttribute("aria-hidden")).toBe("true");
      expect(b.querySelectorAll("i.is-accent")).toHaveLength(1);
      expect(b.querySelectorAll("i.is-ink")).toHaveLength(1);
    }
    // ENGINE: you 5.3h avg, book 5.0h -> the longer one is 100%, book is shorter
    const first = bars[0].querySelectorAll("i");
    expect((first[0] as HTMLElement).style.width).toBe("100%");
    expect(parseFloat((first[1] as HTMLElement).style.width)).toBeCloseTo(93.75, 1);
    expect(bars[0].textContent).toContain("5.3h");
    expect(bars[0].textContent).toContain("5.0h");
  });

  it("states a reason, n= and range, and a screen-reader equivalent with both numbers", () => {
    const { container } = renderBig(entries);
    const text = container.textContent ?? "";
    expect(text).toContain("n=3 · range 0.80–1.40×");
    expect(text).toMatch(/over the book a job across 3 timed — mostly one long one/);
    expect(container.querySelector(".sr-only")?.textContent).toMatch(/you 5\.3 hours, book 5\.0 hours/);
    // n= replaced the old "N timed" cell line — one labelled count per row
    expect(container.querySelectorAll(".ins-cell-sub").length).toBe(2);
    expect(container.querySelector(".ins-cell-sub")?.textContent).not.toMatch(/timed/);
  });

  it("dims a provisional row and says how many more readings it needs", () => {
    const { container } = renderBig(entries);
    const bars = container.querySelectorAll(".ins-cmp");
    expect(bars[0].classList.contains("is-dim")).toBe(false);
    expect(bars[1].classList.contains("is-dim")).toBe(true);
    expect(container.textContent).toContain("2 more readings before it counts as a pattern");
    expect(container.textContent).toContain("n=1");
    expect(container.textContent).not.toMatch(/n=1 · range/);
  });

  it("never uses a state colour or the word efficiency on the bars", () => {
    const { container } = renderBig(entries);
    expect(container.querySelector(".ins-cmp .ins-good, .ins-cmp .ins-bad, .ins-cmp .is-good, .ins-cmp .is-bad")).toBeNull();
    expect((container.textContent ?? "").toLowerCase()).not.toContain("efficien");
  });
});

describe("strongestDaySub", () => {
  it("spells the weekday out in full before pluralising", () => {
    expect(strongestDaySub(4, 3)).toBe("Thursdays, over 3 days");
    expect(strongestDaySub(2, 5)).toBe("Tuesdays, over 5 days");
  });
  it("goes singular at one day", () => {
    expect(strongestDaySub(4, 1)).toBe("Thursday, over 1 day");
  });
});

describe("BigJobsSection — Show all", () => {
  // Seven timed codes, so two sit behind the toggle.
  const many = Array.from({ length: BIG_JOBS_COLLAPSED + 2 }, (_, i) =>
    mk(`j${i}`, `JOB${i}`, 3, 3 + i * 0.1),
  );
  const shownRows = (c: HTMLElement) => c.querySelectorAll("tr.ins-cmp-head").length;

  it("shows the first few and says how many there are", () => {
    const { container } = renderBig(many);
    expect(shownRows(container)).toBe(BIG_JOBS_COLLAPSED);
    expect(screen.getByRole("button", { name: `Show all ${many.length}` })).toBeTruthy();
  });

  it("expands to every job and collapses back", () => {
    const { container } = renderBig(many);
    fireEvent.click(screen.getByRole("button", { name: /Show all/ }));
    expect(shownRows(container)).toBe(many.length);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fewer);
    expect(shownRows(container)).toBe(BIG_JOBS_COLLAPSED);
  });

  it("has no toggle when everything already fits", () => {
    renderBig(many.slice(0, BIG_JOBS_COLLAPSED));
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});
