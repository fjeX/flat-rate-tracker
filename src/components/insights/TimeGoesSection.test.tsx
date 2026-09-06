// @vitest-environment jsdom
//
// "Where your time goes" — the two things a row on this table has to get right
// about ITSELF, both of which it got wrong.
//
//   where-time-goes-uses-count-mismatch
//     The use count was `row.uses` — every line of the code, timed or not —
//     printed directly beside hours that, on an `unpaid` row, come from the
//     comeback subset only. "8 uses · 0.0h flag → 6.2h actual" under an
//     "unpaid rework" pill reads as eight alignments that were all rework, when
//     two of the eight were. The right number was already in the row and
//     already on screen: the pill's tooltip quotes `unpaidUses`.
//
//   opcode-name-collision-indistinguishable
//     `op_codes.code` has no unique constraint and a one-time line's code is
//     free text, so a library ALIGN and a typed ALIGN are two different rows
//     rendering the same label. `groupKey` never merged them (`lib:` vs
//     `custom:`); only the screen could not tell them apart, and the one hint it
//     had — description — is optional and routinely blank.
//
// Both tables in the section are asserted. The phone list and the desktop table
// render from the same array through different JSX, which is exactly how one of
// them gets fixed and the other does not.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { TimeGoesSection } from "./InsightsView";
import { opCodeState, type OpCodePerformance } from "@/lib/insights";

afterEach(cleanup);

function row(p: Partial<OpCodePerformance> & { key: string }): OpCodePerformance {
  return {
    code: "ALIGN",
    description: "",
    uses: 0,
    timedUses: 0,
    flagTotal: 0,
    actualTotal: 0,
    ratio: null,
    unpaidHours: 0,
    unpaidUses: 0,
    implausibleUses: 0,
    ...p,
  };
}

// The escalated row: eight alignments, two of them comebacks. Zero flag and no
// ratio, 6.2h of rework — an `unpaid` row, so its hours are the comeback pair's.
const UNPAID = row({
  key: "lib:align-1",
  code: "ALIGN",
  uses: 8,
  unpaidUses: 2,
  unpaidHours: 6.2,
});

// The control: a fully measured row, whose hours DO describe every line it
// counted. Its count must not move.
const MEASURED = row({
  key: "lib:brake-1",
  code: "BRAKE",
  uses: 5,
  timedUses: 5,
  flagTotal: 10,
  actualTotal: 12,
  ratio: 1.2,
});

function section(rows: OpCodePerformance[]) {
  return render(
    <TimeGoesSection
      rows={rows}
      sortCol="ratio"
      sortDir="desc"
      onSort={() => {}}
    />,
  );
}

describe("the use count beside the hours", () => {
  it("counts only the comeback lines on an unpaid-rework row", () => {
    // Guard: if this row ever stops being `unpaid` the assertions below are
    // about a different code path and prove nothing.
    expect(opCodeState(UNPAID)).toBe("unpaid");

    section([UNPAID]);

    // Phone list: "2 uses · 0.0h flag → 6.2h actual", never "8 uses".
    expect(screen.getByText(/2 uses · /)).toBeTruthy();
    expect(screen.queryByText(/8 uses/)).toBeNull();
    // Desktop table: the Uses cell, which is the bare number on its own.
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("8")).toBeNull();
  });

  it("still prints the full count on a measured row", () => {
    expect(opCodeState(MEASURED)).toBe("measured");

    section([MEASURED]);

    expect(screen.getByText(/5 uses · /)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });
});

describe("two rows, one code", () => {
  // The collision, exactly: the same displayed code from two different origins,
  // and — the ordinary case — no description on either to tell them apart.
  const LIBRARY = row({ key: "lib:align-1", code: "ALIGN", uses: 3 });
  const ONE_TIME = row({ key: "custom:ALIGN", code: "ALIGN", uses: 1 });

  it("labels each row with where its code came from", () => {
    section([LIBRARY, ONE_TIME]);

    // Once in the phone list and once in the table, for each row.
    expect(screen.getAllByText("library")).toHaveLength(2);
    expect(screen.getAllByText("one-time")).toHaveLength(2);
  });

  it("does not lean on the description, which is usually empty", () => {
    section([LIBRARY, ONE_TIME]);

    expect(LIBRARY.description).toBe("");
    expect(ONE_TIME.description).toBe("");
    // Two rows carrying one code text are still two distinguishable rows.
    expect(screen.getAllByText("ALIGN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("library").length).toBeGreaterThan(0);
    expect(screen.getAllByText("one-time").length).toBeGreaterThan(0);
  });
});
