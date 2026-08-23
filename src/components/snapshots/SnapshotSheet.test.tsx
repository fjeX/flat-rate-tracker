// @vitest-environment jsdom
//
// The snapshot sheet is a shareable "Work Record" — a tech hands it to a
// service manager the same way the dispute pack gets handed over. It had its
// own private `fmt()`, with `minimumFractionDigits: n % 1 === 0 ? 0 : 1`, which
// diverged from fmtHours in two ways at once:
//
//   * a whole number printed "2" where the rest of the app prints "2.0", so the
//     same figure has two shapes depending on which screen you're on;
//   * a sub-resolution nonzero printed "0.0", the flat-zero-for-real-work defect
//     lib/format.ts exists to end.
//
// It uses the grouping variant rather than plain fmtHours because a snapshot is
// cut at an RO-count threshold — the later ones sit thousands of flag hours in.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import type { PortfolioSnapshot, SnapshotStats } from "@/lib/types";
import { SnapshotSheet } from "./SnapshotSheet";

afterEach(cleanup);

function snapshot(
  totalFlagHours: number,
  extraStats: Partial<SnapshotStats> = {},
): PortfolioSnapshot {
  return {
    id: "s1",
    seq: 1,
    roThreshold: 10,
    createdAt: "2026-08-20T02:00:00Z",
    stats: {
      roCount: 10,
      totalFlagHours,
      avgVsBook: null,
      photoCount: 0,
      topOps: [],
      firstDate: "2026-01-02",
      lastDate: "2026-08-19",
      workDays: 5,
      ...extraStats,
    },
  };
}

/** The specs paragraph, whitespace-normalized. */
function specs(): string {
  return (
    document.querySelector(".gami-sheet-specs")?.textContent?.replace(/\s+/g, " ") ?? ""
  );
}

/** The "Hours flagged" cell's value, as rendered. */
function hoursCell(): string {
  const cell = Array.from(document.querySelectorAll(".gami-sheet-cell")).find(
    (c) => c.querySelector(".k")?.textContent === "Hours flagged",
  );
  if (!cell) throw new Error("no Hours flagged cell rendered");
  return cell.querySelector(".v")?.textContent ?? "";
}

describe("SnapshotSheet renders hours through the shared formatter", () => {
  it("keeps the trailing zero on a whole number, like every other surface", () => {
    render(<SnapshotSheet snapshot={snapshot(2)} />);
    expect(hoursCell()).toBe("2.0");
  });

  it("never prints a bare zero for a nonzero total", () => {
    render(<SnapshotSheet snapshot={snapshot(0.02)} />);
    expect(hoursCell()).toBe("<0.1");
  });

  it("still prints a true zero as 0.0", () => {
    render(<SnapshotSheet snapshot={snapshot(0)} />);
    expect(hoursCell()).toBe("0.0");
  });

  it("groups thousands — later snapshots are cut deep into a career", () => {
    render(<SnapshotSheet snapshot={snapshot(4210.25)} />);
    expect(hoursCell()).toBe("4,210.3");
  });

  it("rounds the ordinary cases exactly as fmtHours does", () => {
    for (const [total, expected] of [
      [5.35, "5.4"],
      [5.34, "5.3"],
      [41.15, "41.2"],
    ] as const) {
      cleanup();
      render(<SnapshotSheet snapshot={snapshot(total)} />);
      expect(hoursCell()).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Efficiency gating — the sheet used to print `Math.round(overallEfficiency)%`
// raw, the ONLY one of the app's efficiency surfaces that never routed through
// efficiencyDisplay, and the only one whose figure is permanent: it is stored
// in portfolio_snapshots.stats, carried verbatim through the backup bundle,
// and handed to a service manager. A hollowed percentage is most dangerous
// exactly here, because it looks plausible and cannot be re-derived from the
// sheet.
// ---------------------------------------------------------------------------
describe("SnapshotSheet gates the frozen efficiency figure", () => {
  it("prints the percentage when nothing was excluded", () => {
    render(
      <SnapshotSheet
        snapshot={snapshot(40, {
          overallEfficiency: 112.4,
          efficiencySource: "scheduled",
          unpairedFlagHours: 0,
          unpairedDays: 0,
        })}
      />,
    );
    expect(specs()).toContain("Overall efficiency: 112% (vs scheduled hours)");
  });

  it("withholds the figure when every flagged hour was unmeasurable", () => {
    render(
      <SnapshotSheet
        snapshot={snapshot(42, {
          overallEfficiency: 0,
          efficiencySource: "scheduled",
          unpairedFlagHours: 42,
          unpairedDays: 2,
        })}
      />,
    );
    const text = specs();
    expect(text).toContain("Overall efficiency: not measurable");
    expect(text).toContain("42.0h, all of the flagged hours in this range");
    expect(text).toContain("fell on 2 days with no hours to measure them against");
    expect(text).not.toContain("0%");
    // Frozen record, not a period still running: nothing here resolves later,
    // so the live surfaces' "yet"/"so far" wording would be a lie.
    expect(text).not.toMatch(/yet|so far/);
  });

  it("withholds the figure when most of the range was unmeasurable", () => {
    render(
      <SnapshotSheet
        snapshot={snapshot(40, {
          overallEfficiency: 30,
          efficiencySource: "clocked",
          unpairedFlagHours: 32,
          unpairedDays: 1,
        })}
      />,
    );
    const text = specs();
    expect(text).toContain("Overall efficiency: not shown");
    expect(text).toContain("32.0h of the 40.0h flagged in this range fell on a day");
    expect(text).toContain("would leave out most of the work");
    expect(text).not.toContain("30%");
    expect(text).not.toMatch(/yet|so far/);
  });

  it("prints the percentage when a minority of the range was unmeasurable", () => {
    render(
      <SnapshotSheet
        snapshot={snapshot(40, {
          overallEfficiency: 90,
          efficiencySource: "clocked",
          unpairedFlagHours: 4,
          unpairedDays: 1,
        })}
      />,
    );
    expect(specs()).toContain("Overall efficiency: 90% (vs clocked hours)");
  });

  it("says nothing at all when the snapshot has no efficiency", () => {
    render(
      <SnapshotSheet
        snapshot={snapshot(40, {
          overallEfficiency: null,
          efficiencySource: null,
          unpairedFlagHours: null,
          unpairedDays: null,
        })}
      />,
    );
    expect(specs()).not.toContain("Overall efficiency");
  });

  it("renders a blob from an older build that carries NEITHER unpaired key", () => {
    // Round trip: a backup restored from a build before these fields existed
    // has the percentage and no record of what it excluded. Absent is not 0 —
    // but there is nothing to gate on, so the sheet must keep printing what it
    // printed before rather than blanking a figure or crashing. The
    // gamification backfill is what turns this row into a gated one.
    const snap = snapshot(40, {
      overallEfficiency: 88,
      efficiencySource: "clocked",
    });
    expect("unpairedFlagHours" in snap.stats).toBe(false);
    expect("unpairedDays" in snap.stats).toBe(false);
    render(<SnapshotSheet snapshot={snap} />);
    expect(specs()).toContain("Overall efficiency: 88% (vs clocked hours)");
  });
});
