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
import type { PortfolioSnapshot } from "@/lib/types";
import { SnapshotSheet } from "./SnapshotSheet";

afterEach(cleanup);

function snapshot(totalFlagHours: number): PortfolioSnapshot {
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
    },
  };
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
