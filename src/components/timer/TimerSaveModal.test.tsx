// @vitest-environment jsdom
//
// Regression cover for `timer-receipt-clock-keeps-running`.
//
// The modal freezes `elapsed` when it opens — on purpose, because a total that
// ticks while you're reading it is unreviewable. But saveTimerAction recomputes
// from persisted accumulators at submit time and deliberately ignores whatever
// the client sent ("the server's is what actually happened"), so the number a
// tech reviewed and the number written to the RO can legitimately differ.
// Observed in the wild: the modal read 0.31h, the row got 0.32h, and nothing
// ever told the tech which one landed.
//
// THE FIX IS NOT TO UNFREEZE THE DISPLAY. It's to restate, after the save, the
// figures saveTimerAction RETURNED. So every test here mocks the action to
// return values that DIFFER from the frozen projection — a test where the two
// agree proves nothing, because the old code would pass it by rendering the
// client's own number.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import type { TimerSlot } from "@/lib/timer";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const saveTimerAction = vi.fn();
vi.mock("@/app/actions/timer", () => ({
  saveTimerAction: (...args: unknown[]) => saveTimerAction(...args),
}));

import { TimerSaveModal, saveDivergence } from "./TimerSaveModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LINE: EntryOpCode = {
  id: "line-1",
  opCodeId: "oc-1",
  custom: false,
  customCode: null,
  customDescription: null,
  flagHours: 1.5,
  actualHours: null,
  notes: "",
  position: 0,
  subOpCodeId: null,
  laborType: "customer_pay",
};

const ENTRY: Entry = {
  id: "e-1",
  userId: "u-1",
  createdAt: "2026-03-12T00:00:00Z",
  updatedAt: "2026-03-12T00:00:00Z",
  date: "2026-03-12",
  roNumber: "88421",
  vehicle: { year: "2019", make: "Toyota", model: "Camry", vin: "", mileage: "" },
  opCodes: [LINE],
  flagHours: 1.5,
  notes: "",
};

const LIBRARY: OpCode[] = [
  {
    id: "oc-1",
    userId: "u-1",
    code: "A1",
    description: "Diagnose",
    flagHours: 1.5,
    notes: "",
    tags: [],
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    subOpCodes: [],
  },
];

/** 0.31h of banked work, clock stopped — so the frozen projection is exactly
 * 0.31h and can't drift under the test. */
const SLOT: TimerSlot = {
  id: "t-1",
  slot: 1,
  entryId: "e-1",
  lineId: "line-1",
  status: "paused",
  startTime: null,
  workAccumulated: 0.31 * 3_600_000,
  holdPartsAccumulated: 0,
  holdApprovalAccumulated: 0,
};

function result(over: Partial<Record<string, unknown>> = {}) {
  return {
    workHours: 0.32,
    previousHours: null,
    totalHours: 0.32,
    waitPartsHours: 0,
    waitApprovalHours: 0,
    ledgerWritten: true,
    ...over,
  };
}

function renderModal(slot: TimerSlot = SLOT, onClose = vi.fn()) {
  render(
    <TimerSaveModal
      slot={slot}
      entry={ENTRY}
      library={LIBRARY}
      capAt={null}
      onClose={onClose}
    />,
  );
  return onClose;
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /save & close timer/i }));
}

describe("TimerSaveModal — post-save confirmation", () => {
  it("shows the pre-save projection from the frozen snapshot", () => {
    renderModal();
    // The freeze is deliberate and stays: 0.31h is what's reviewed.
    expect(screen.getByText(/0\.31h/)).toBeTruthy();
  });

  it("restates the SERVER's figure, not the frozen projection, when they differ", async () => {
    saveTimerAction.mockResolvedValue(result());
    const onClose = renderModal();
    await save();

    // The confirmation must appear rather than closing out silently.
    await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    // The saved figure is the server's 0.32h — twice (added, and new total).
    expect(screen.getAllByText("0.32h").length).toBeGreaterThanOrEqual(2);
    // And the frozen 0.31h survives only as the explicitly-labelled contrast,
    // never as the headline "saved" figure.
    expect(screen.getByText(/isn't the 0\.31h this window showed/)).toBeTruthy();
    // The pre-save projection panel is gone — 0.31h appears only in that
    // contrast sentence, never as a figure claiming to be what was saved.
    expect(screen.queryByText("0.31h")).toBeNull();
  });

  it("closes straight out when the server figure matches what was shown", async () => {
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.31 }),
    );
    const onClose = renderModal();
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/this window showed/)).toBeNull();
  });

  it("discloses waiting time the modal never promised a ledger row for", async () => {
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.31, waitPartsHours: 0.05 }),
    );
    const onClose = renderModal();
    await save();

    await waitFor(() =>
      expect(screen.getByText(/0\.05h waiting on parts/)).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still reports a failed ledger write", async () => {
    saveTimerAction.mockResolvedValue(result({ ledgerWritten: false }));
    renderModal();
    await save();

    await waitFor(() =>
      expect(screen.getByText(/unpaid-time table isn't set up yet/)).toBeTruthy(),
    );
    expect(screen.getByText(/Saved with a warning/)).toBeTruthy();
  });
});

describe("saveDivergence", () => {
  const shown = { workHours: 0.31, newTotal: 0.31, ledgerPromised: false };

  it("flags a worked-hours difference", () => {
    expect(
      saveDivergence(
        { workHours: 0.32, totalHours: 0.32, waitPartsHours: 0, waitApprovalHours: 0 },
        shown,
      ).hours,
    ).toBe(true);
  });

  it("flags a total-hours difference even when the added hours agree", () => {
    // The line's actualHours can be stale in the client's copy of the entry.
    expect(
      saveDivergence(
        { workHours: 0.31, totalHours: 0.62, waitPartsHours: 0, waitApprovalHours: 0 },
        shown,
      ).hours,
    ).toBe(true);
  });

  it("says nothing when both figures agree", () => {
    expect(
      saveDivergence(
        { workHours: 0.31, totalHours: 0.31, waitPartsHours: 0, waitApprovalHours: 0 },
        shown,
      ).any,
    ).toBe(false);
  });

  it("does not claim a ledger row for 0.01h — that band straddles the 30s gate", () => {
    // msToHours rounds to hundredths: 0.01h is anywhere from 18s to 54s, and
    // MIN_LEDGERED_HOLD_MS is 30s. Claiming "logged as unpaid time" there
    // could be a lie about a money document.
    expect(
      saveDivergence(
        {
          workHours: 0.31,
          totalHours: 0.31,
          waitPartsHours: 0.01,
          waitApprovalHours: 0,
        },
        shown,
      ).undisclosedWait,
    ).toBe(false);
  });

  it("stays quiet about waiting time the modal already promised", () => {
    expect(
      saveDivergence(
        {
          workHours: 0.31,
          totalHours: 0.31,
          waitPartsHours: 0.4,
          waitApprovalHours: 0,
        },
        { ...shown, ledgerPromised: true },
      ).undisclosedWait,
    ).toBe(false);
  });
});
