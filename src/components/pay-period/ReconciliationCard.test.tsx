// @vitest-environment jsdom
//
// Regression cover for `recon-input-stale-after-recovery-apply`.
//
// THE BUG: ReconLineRow seeds `paidText`/`saved` from `line.paidHours` ONCE, in
// useState. The row is keyed `key={line.id}` — a stable key — so it survives the
// router.refresh() that DisputeOutcomeCard's "apply recovery" fires after it
// writes new paid_hours. The Server Component props update, the tiles above show
// the new figure, and this one input keeps yesterday's number until a full page
// reload.
//
// WHY THE FIRST TEST RERENDERS INSTEAD OF REMOUNTING: a remount test passes
// against the broken code and proves nothing — fresh useState reads the fresh
// prop. The bug only exists on an ALREADY-MOUNTED instance, so the test drives
// the card the way the page does: render, open it, then rerender with a new
// entries array carrying new paidHours. Same line.id ⇒ same React instance.
//
// The chosen line goes 2.0 → 3.0 against a 5.0 flag, i.e. short → still short,
// deliberately: a line that reached "paid" would drop off the working list and
// unmount, and an unmounted row can't demonstrate stale state.
//
// WHY THE SECOND TEST EXISTS: the fix must not become a worse bug. Overwriting
// hours the tech is halfway through typing loses their input, so the resync
// skips while the box is focused or dirty. That skip is behaviour, not an
// implementation detail, so it gets its own assertion — including that the
// deferred value lands once they leave the box.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ReconciliationCard } from "./ReconciliationCard";
import type { Entry, EntryOpCode } from "@/lib/types";

// "use server" module — it reaches the db client on import. Nothing here taps a
// save, so a stub keeps jsdom out of server code.
vi.mock("@/app/actions/entries", () => ({
  setLinePaidHoursAction: vi.fn(async () => ({})),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const LINE_ID = "line-1";

function line(paidHours: number | null): EntryOpCode {
  return {
    id: LINE_ID,
    opCodeId: null,
    custom: true,
    customCode: "DIAG",
    customDescription: null,
    flagHours: 5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours,
  };
}

function entries(paidHours: number | null): Entry[] {
  return [
    {
      id: "entry-1",
      userId: "u1",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
      date: "2026-07-20",
      roNumber: "12345",
      vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
      opCodes: [line(paidHours)],
      flagHours: 5,
      notes: "",
    },
  ];
}

/** Render the card, open the collapsed body, and hand back the paid-hrs box. */
function renderOpen(paidHours: number | null) {
  const view = render(
    <ReconciliationCard entries={entries(paidHours)} today="2026-07-21" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Pay Reconciliation/ }));
  const input = screen.getByLabelText(
    /Paid flag hours for RO 12345/,
  ) as HTMLInputElement;
  return { ...view, input };
}

describe("ReconciliationCard — paid-hours row vs. an external write", () => {
  it("shows the new figure when line.paidHours changes on the mounted row", () => {
    const { rerender, input } = renderOpen(2);
    expect(input.value).toBe("2");

    // What applyRecovery + router.refresh() looks like from this card's side:
    // same mounted row (same line.id ⇒ same key), new server prop.
    rerender(
      <ReconciliationCard entries={entries(3)} today="2026-07-21" />,
    );

    expect(input.value).toBe("3");
  });

  it("does not clobber hours the tech is part-way through typing", () => {
    const { rerender, input } = renderOpen(2);

    // Tech is in the box with an uncommitted edit.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "4.5" } });

    rerender(
      <ReconciliationCard entries={entries(3)} today="2026-07-21" />,
    );

    // Their typing survives the external write.
    expect(input.value).toBe("4.5");
  });

  it("delivers a change that arrived mid-typing once the box is left empty-handed", () => {
    const { rerender, input } = renderOpen(2);

    // Focused, but nothing typed — the tech only tabbed in.
    fireEvent.focus(input);
    rerender(
      <ReconciliationCard entries={entries(3)} today="2026-07-21" />,
    );
    // Deferred while they are in the box, so the number can't move under them.
    expect(input.value).toBe("2");

    fireEvent.blur(input);
    // Nothing was typed, so commit() is a no-op and the server value lands.
    expect(input.value).toBe("3");
  });
});
