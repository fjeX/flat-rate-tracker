// @vitest-environment jsdom
//
// Unit cover for `timer-receipt-clock-keeps-running`.
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
// figures saveTimerAction RETURNED. So the tests here use values that DIFFER
// from the frozen projection — a test where the two agree proves nothing.
//
// WHAT THIS FILE CANNOT PROVE: that the receipt ever reaches a human. It
// renders components directly with fixed props, and the original defect was
// that TimerSlots UNMOUNTS the save modal the moment the save deletes the
// slot. That belongs in TimerSlots.test.tsx, which drives the real mount path.
// Keep it there: a direct render of the receipt passes whether or not anybody
// can ever see it.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

import {
  TimerSaveModal,
  TimerSaveReceipt,
  saveDivergence,
  type ShownFigures,
} from "./TimerSaveModal";

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

function result(over: Record<string, unknown> = {}) {
  return {
    workHours: 0.32,
    previousHours: null,
    totalHours: 0.32,
    waitPartsHours: 0,
    waitApprovalHours: 0,
    waitPartsLedgered: false,
    waitApprovalLedgered: false,
    ledgerWritten: true,
    ...over,
  };
}

/** What the modal froze and the tech approved. */
const SHOWN: ShownFigures = {
  workHours: 0.31,
  newTotal: 0.31,
  partsPromised: false,
  approvalPromised: false,
};

function renderModal(slot: TimerSlot = SLOT) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TimerSaveModal
      slot={slot}
      entry={ENTRY}
      library={LIBRARY}
      capAt={null}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /save & close timer/i }));
}

describe("TimerSaveModal — what it hands back", () => {
  it("shows the pre-save projection from the frozen snapshot", () => {
    renderModal();
    // The freeze is deliberate and stays: 0.31h is what's reviewed.
    expect(screen.getByText(/0\.31h/)).toBeTruthy();
  });

  it("hands the parent a receipt carrying the SERVER's figures", async () => {
    saveTimerAction.mockResolvedValue(result());
    const { onSaved } = renderModal();
    await save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const receipt = onSaved.mock.calls[0][0];
    expect(receipt).not.toBeNull();
    expect(receipt.result.workHours).toBe(0.32);
    expect(receipt.roNumber).toBe("88421");
    // The frozen projection travels too, but only as the labelled contrast.
    expect(receipt.shown.workHours).toBe(0.31);
  });

  it("hands back null when the server figure matches what was shown", async () => {
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.31 }),
    );
    const { onSaved } = renderModal();
    await save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
  });

  it("hands back a receipt when the ledger write failed", async () => {
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.31, ledgerWritten: false }),
    );
    const { onSaved } = renderModal();
    await save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).not.toBeNull();
  });
});

describe("TimerSaveReceipt", () => {
  function renderReceipt(
    over: Record<string, unknown> = {},
    shown: Partial<ShownFigures> = {},
  ) {
    render(
      <TimerSaveReceipt
        receipt={{
          roNumber: "88421",
          result: result(over) as never,
          shown: { ...SHOWN, ...shown },
        }}
        onClose={vi.fn()}
      />,
    );
  }

  it("restates the server figure and names the clock as the reason", () => {
    renderReceipt();
    expect(screen.getAllByText("0.32h").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/isn't the 0\.31h this window showed/)).toBeTruthy();
    // 0.31h survives only as the labelled contrast, never as a saved figure.
    expect(screen.queryByText("0.31h")).toBeNull();
  });

  it("blames the baseline, not the clock, when only the total moved", () => {
    renderReceipt({ workHours: 0.31, totalHours: 0.62 });
    expect(screen.queryByText(/clock kept running/)).toBeNull();
    expect(screen.getByText(/already had time on it/)).toBeTruthy();
    expect(screen.getByText(/0\.62h/)).toBeTruthy();
  });

  it("discloses a hold the server says it ledgered, even at 0.01h", () => {
    renderReceipt({
      workHours: 0.31,
      totalHours: 0.31,
      waitPartsHours: 0.01,
      waitPartsLedgered: true,
    });
    expect(screen.getByText(/0\.01h waiting on parts/)).toBeTruthy();
  });

  it("still reports a failed ledger write", () => {
    renderReceipt({ ledgerWritten: false });
    expect(screen.getByText(/unpaid-time table isn't set up yet/)).toBeTruthy();
    expect(screen.getByText(/Saved with a warning/)).toBeTruthy();
  });
});

describe("saveDivergence", () => {
  it("flags a worked-hours difference as the clock, not the baseline", () => {
    const d = saveDivergence(
      {
        workHours: 0.32,
        totalHours: 0.32,
        waitPartsLedgered: false,
        waitApprovalLedgered: false,
      },
      SHOWN,
    );
    expect(d.addedHours).toBe(true);
    expect(d.baselineTotal).toBe(false);
  });

  it("flags a stale baseline separately when the added hours agree", () => {
    // The line's actualHours can be stale in the client's copy of the entry.
    // Same divergence, DIFFERENT cause — and the old lumped flag printed "the
    // clock kept running" here, next to two identical numbers.
    const d = saveDivergence(
      {
        workHours: 0.31,
        totalHours: 0.62,
        waitPartsLedgered: false,
        waitApprovalLedgered: false,
      },
      SHOWN,
    );
    expect(d.baselineTotal).toBe(true);
    expect(d.addedHours).toBe(false);
  });

  it("says nothing when both figures agree", () => {
    expect(
      saveDivergence(
        {
          workHours: 0.31,
          totalHours: 0.31,
          waitPartsLedgered: false,
          waitApprovalLedgered: false,
        },
        SHOWN,
      ).any,
    ).toBe(false);
  });

  it("trusts the server's ledger verdict over the rounded hours", () => {
    // 0.01h is anywhere from 18s to 54s and MIN_LEDGERED_HOLD_MS is 30s, so
    // the rounded figure cannot decide. The server can, and now says so.
    const base = {
      workHours: 0.31,
      totalHours: 0.31,
      waitApprovalLedgered: false,
    };
    expect(
      saveDivergence({ ...base, waitPartsLedgered: false }, SHOWN)
        .undisclosedWait,
    ).toBe(false);
    expect(
      saveDivergence({ ...base, waitPartsLedgered: true }, SHOWN)
        .undisclosedWait,
    ).toBe(true);
  });

  it("stays quiet about waiting time the modal already promised", () => {
    expect(
      saveDivergence(
        {
          workHours: 0.31,
          totalHours: 0.31,
          waitPartsLedgered: true,
          waitApprovalLedgered: false,
        },
        { ...SHOWN, partsPromised: true },
      ).undisclosedWait,
    ).toBe(false);
  });

  it("does not let a promise about one hold silence the other", () => {
    // Parts was promised; the approval hold only crossed the 30s gate after
    // the display froze. A single lumped `ledgerPromised` swallowed this.
    expect(
      saveDivergence(
        {
          workHours: 0.31,
          totalHours: 0.31,
          waitPartsLedgered: true,
          waitApprovalLedgered: true,
        },
        { ...SHOWN, partsPromised: true },
      ).undisclosedApproval,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// timer-save-modal-stale-hold-promise
//
// The worked total is frozen at open on purpose (above). The HOLD figures are
// not, and that distinction is the whole point of this block: the modal only
// prints "waiting time is logged as unpaid time against this RO" once a hold
// clears MIN_LEDGERED_HOLD_MS (30s), and the server re-applies that gate to
// LIVE accumulators at commit. Sit in this modal across the 30s boundary of a
// running hold and the frozen copy said "0m" and promised nothing while the row
// was written anyway — true hours, but the tech only found out from the receipt
// afterwards.
//
// These tests are worthless unless they STRADDLE the boundary: open under 30s,
// advance past it. A test that opens above the gate passes with or without the
// fix, because a frozen snapshot taken above the gate already promises.
// ---------------------------------------------------------------------------
describe("TimerSaveModal — the hold promise is live, the worked total is not", () => {
  const T0 = new Date("2026-03-12T17:30:00Z").getTime();
  const PROMISE = /logged as unpaid time against this RO/;

  /** On a parts hold RIGHT NOW, `heldMs` into it, with 0.31h of banked work. */
  function holdSlot(heldMs: number): TimerSlot {
    return {
      id: "t-2",
      slot: 1,
      entryId: "e-1",
      lineId: "line-1",
      status: "hold_parts",
      startTime: T0 - heldMs,
      workAccumulated: 0.31 * 3_600_000,
      holdPartsAccumulated: 0,
      holdApprovalAccumulated: 0,
    };
  }

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("flips the hold readout and the promise when a running hold crosses 30s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renderModal(holdSlot(10_000));

    // 10s in. The time is shown honestly; no row is coming, so nothing is
    // promised. Both halves matter — a missing readout would make the second
    // assertion pass for the wrong reason.
    expect(screen.getByText("0m")).toBeTruthy();
    expect(screen.queryByText(PROMISE)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    // 35s in. saveTimerAction WILL write the row now, so the screen says so
    // before the tech commits instead of after.
    expect(screen.getByText("1m")).toBeTruthy();
    expect(screen.getByText(PROMISE)).toBeTruthy();
  });

  it("leaves the worked total frozen while the hold figures tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renderModal(holdSlot(10_000));
    // formatElapsed(0.31h) — the figure being reviewed.
    expect(screen.getByText(/00:18:36/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    // Control: the tick really did fire in this render pass.
    expect(screen.getByText("1m")).toBeTruthy();
    // ...and the headline did not move with it. (A slot banks into exactly one
    // accumulator, so a hold cannot accrue work — this pins the wiring, not the
    // arithmetic: it fails if the worked line is ever re-pointed at `live`
    // alongside a differently-clamped `capAt`.)
    expect(screen.getByText(/00:18:36/)).toBeTruthy();
    expect(screen.getAllByText(/0\.31h/).length).toBeGreaterThan(0);
  });

  it("carries the LIVE promise into the divergence check, so a promised row isn't re-announced", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { onSaved } = renderModal(holdSlot(10_000));
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    // Real timers from here: the save is a promise, not a timer.
    vi.useRealTimers();

    saveTimerAction.mockResolvedValue(
      result({ waitPartsHours: 0.01, waitPartsLedgered: true }),
    );
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const receipt = onSaved.mock.calls[0][0];
    // The promise handed to saveDivergence is the one the screen was making at
    // the moment of the click — not the one it made 25 seconds earlier.
    expect(receipt.shown.partsPromised).toBe(true);
    expect(saveDivergence(receipt.result, receipt.shown).undisclosedParts).toBe(
      false,
    );
  });

  it("still discloses after the fact when the row crosses the gate AFTER the click", async () => {
    // The no-bypass chain, end to end and unweakened: going live narrows the
    // window but cannot close it — the server can cross 30s in the moment
    // between the click and the commit. When the modal promised nothing and the
    // server wrote a row anyway, the receipt must still say so.
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { onSaved } = renderModal(holdSlot(10_000));
    expect(screen.queryByText(PROMISE)).toBeNull();
    vi.useRealTimers();

    saveTimerAction.mockResolvedValue(
      result({
        workHours: 0.31,
        totalHours: 0.31,
        waitPartsHours: 0.01,
        waitPartsLedgered: true,
      }),
    );
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const receipt = onSaved.mock.calls[0][0];
    expect(receipt).not.toBeNull();
    expect(receipt.shown.partsPromised).toBe(false);
    expect(saveDivergence(receipt.result, receipt.shown).undisclosedParts).toBe(
      true,
    );
  });
});

describe("TimerSaveReceipt — the title carries the new fact", () => {
  function renderReceipt(over: Record<string, unknown> = {}) {
    render(
      <TimerSaveReceipt
        receipt={{ roNumber: "88421", result: result(over) as never, shown: SHOWN }}
        onClose={vi.fn()}
      />,
    );
  }

  it("says unpaid time was logged in the title, not only in the body", () => {
    renderReceipt({
      workHours: 0.31,
      totalHours: 0.31,
      waitPartsHours: 0.01,
      waitPartsLedgered: true,
    });
    // A tech who reads the title and taps Done has to learn this from the title.
    expect(screen.getByText(/unpaid time also logged/)).toBeTruthy();
    expect(screen.getByText(/0\.01h waiting on parts/)).toBeTruthy();
  });

  it("stays a plain Saved when the only divergence is the baseline total", () => {
    renderReceipt({ workHours: 0.31, totalHours: 0.62 });
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByText(/unpaid time also logged/)).toBeNull();
  });

  it("keeps the failed ledger write a warning even when a hold went undisclosed", () => {
    // A failed write outranks the disclosure: the hours did NOT land.
    renderReceipt({
      workHours: 0.31,
      totalHours: 0.31,
      waitPartsHours: 0.01,
      waitPartsLedgered: true,
      ledgerWritten: false,
    });
    expect(screen.getByText("Saved with a warning")).toBeTruthy();
  });
});
