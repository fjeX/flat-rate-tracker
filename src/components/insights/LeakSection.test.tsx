// @vitest-environment jsdom
//
// "What's costing you" — the fourth surface that prints the origin tag.
//
//   opcode-name-collision-indistinguishable (leak board)
//     `op_codes.code` has no unique constraint and a one-time line's code is
//     free text, so a library WHL-BRG and a typed WHL-BRG are two different
//     rows printing the same label. The shared OriginTag went to the three
//     op-code tables and skipped this board, so the two rows landed at rank 2
//     and rank 16 with nothing on screen separating them — while the SAME two
//     codes read correctly on "Where your time goes" one section away.
//
//     The gate is `leak.source`, not the key prefix: a ledger row keys
//     `ledger:<kind>` and has no origin at all, and opCodeOrigin's
//     `startsWith("lib:")` would label it "custom" — inventing a provenance for
//     a row that has no op code by definition.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { LeakSection } from "./InsightsView";
import { opCodeOrigin, type Leak, type LeakBoard } from "@/lib/insights";

afterEach(cleanup);

function leak(p: Partial<Leak> & { key: string }): Leak {
  return {
    code: "WHL-BRG",
    description: "",
    kind: "overrun",
    source: "opcode",
    hours: 2,
    uses: 3,
    ratio: 1.4,
    ...p,
  };
}

function board(leaks: Leak[]): LeakBoard {
  return { leaks, totalHours: leaks.reduce((s, l) => s + l.hours, 0) };
}

// The exact keys leakBoard() builds — an op-code leak is the op code's group
// key with a kind suffix, so the origin prefix is no longer the whole string.
const LIB = leak({ key: "lib:9f3:overrun", hours: 5, uses: 4 });
const CUSTOM = leak({ key: "custom:WHL-BRG:overrun", hours: 3, uses: 2 });
const LEDGER = leak({
  key: "ledger:waiting_parts",
  code: "Waiting on parts",
  kind: "unpaid_clock",
  source: "ledger",
  hours: 4,
  uses: 6,
  ratio: null,
});

describe("opCodeOrigin on leak keys", () => {
  // startsWith, not an exact match — the suffix must not break the predicate.
  it("reads the origin off a suffixed leak key", () => {
    expect(opCodeOrigin(LIB)).toBe("library");
    expect(opCodeOrigin(CUSTOM)).toBe("custom");
    expect(opCodeOrigin(leak({ key: "lib:9f3:rework" }))).toBe("library");
  });
});

describe("LeakSection origin tags", () => {
  it("tells two identically coded leak rows apart", () => {
    render(<LeakSection board={board([LIB, CUSTOM])} />);

    const codes = screen.getAllByText("WHL-BRG");
    expect(codes).toHaveLength(2);
    // Same code, different tag — the row, not the table, has to carry it.
    expect(within(codes[0].parentElement as HTMLElement).getByText("library")).toBeTruthy();
    expect(within(codes[1].parentElement as HTMLElement).getByText("custom")).toBeTruthy();
  });

  it("prints no tag on a ledger row", () => {
    render(<LeakSection board={board([LEDGER])} />);

    expect(screen.getByText("Waiting on parts")).toBeTruthy();
    // Not "absent because the tag is broken" — absent by design. A ledger row
    // has no op code, so "custom" would be a fabricated claim.
    expect(screen.queryByText("custom")).toBeNull();
    expect(screen.queryByText("library")).toBeNull();
  });

  it("tags only the op-code rows on a mixed board", () => {
    render(<LeakSection board={board([LIB, LEDGER, CUSTOM])} />);

    expect(screen.getAllByText("library")).toHaveLength(1);
    expect(screen.getAllByText("custom")).toHaveLength(1);
  });
});
