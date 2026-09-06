// @vitest-environment jsdom
//
// Regression cover for `timer-receipt-clock-keeps-running`, driven through the
// REAL mount path.
//
// The post-save receipt used to live inside TimerSaveModal, which TimerSlots
// mounts only while `slots` still contains the slot being saved:
//
//     const saveSlot = slots.find((s) => s.id === saveSlotId) ?? null;
//     {saveSlot && saveEntryFor && (<TimerSaveModal ... />)}
//
// saveTimerAction DELETES that slot and revalidates /timer, so the refreshed
// server props no longer contain it — the modal unmounted and took the receipt
// (and its state) with it. Every earlier test rendered TimerSaveModal directly
// with fixed props, so the mount condition was never exercised and a receipt
// that never reached a human passed 36/36.
//
// These tests therefore go through TimerSlots: click Save on the card, save,
// then deliver the revalidated props (slots: []) the way the router would, and
// assert the receipt is STILL on screen.
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
  attachRoToTimerAction: vi.fn(),
  releaseTimerAction: vi.fn(),
  resetTimerAction: vi.fn(),
  setTimerLineAction: vi.fn(),
  setTimerStatusAction: vi.fn(),
}));
vi.mock("@/app/actions/entries", () => ({ saveEntry: vi.fn() }));

import { TimerSlots } from "./TimerSlots";

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

/** 0.31h banked, clock stopped — the frozen projection is exactly 0.31h. */
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

function renderSlots() {
  const view = render(
    <TimerSlots
      slots={[SLOT]}
      attachedEntries={[ENTRY]}
      caps={{}}
      recentEntries={[ENTRY]}
      library={LIBRARY}
      roTemplates={[]}
    />,
  );
  return view;
}

/** What the revalidated server props look like after saveTimerAction deleted
 * the slot: the slot — and the entry derived from it — are simply gone. */
function deliverRevalidatedProps(rerender: (ui: React.ReactElement) => void) {
  rerender(
    <TimerSlots
      slots={[]}
      attachedEntries={[]}
      caps={{}}
      recentEntries={[ENTRY]}
      library={LIBRARY}
      roTemplates={[]}
    />,
  );
}

async function openAndSave() {
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await screen.findByRole("button", { name: /save & close timer/i });
  fireEvent.click(screen.getByRole("button", { name: /save & close timer/i }));
}

describe("TimerSlots — the save receipt survives the save that triggers it", () => {
  it("keeps the receipt on screen after the saved slot leaves the props", async () => {
    saveTimerAction.mockResolvedValue(result());
    const { rerender } = renderSlots();
    await openAndSave();

    await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeTruthy());

    // The revalidate lands. The slot is gone; the receipt must not be.
    deliverRevalidatedProps(rerender);

    expect(screen.getByText(/^Saved$/)).toBeTruthy();
    expect(screen.getAllByText("0.32h").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/isn't the 0\.31h this window showed/)).toBeTruthy();

    // And it goes away only when the human dismisses it.
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByText(/^Saved$/)).toBeNull();
  });

  it("does not blame the clock when only the line's running total diverged", async () => {
    // Worked hours agree exactly; the client's copy of actualHours was stale,
    // so only the TOTAL differs. Saying "the clock kept running" here is a
    // false cause printed on a money document — and the old subtext also
    // printed the frozen 0.31h, which equalled the headline.
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.62 }),
    );
    const { rerender } = renderSlots();
    await openAndSave();

    await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeTruthy());
    // Checked BEFORE the revalidate too, so this test fails on the false cause
    // itself and not merely on the receipt being torn down.
    expect(screen.queryByText(/clock kept running/)).toBeNull();
    expect(screen.queryByText(/isn't the 0\.31h this window showed/)).toBeNull();

    deliverRevalidatedProps(rerender);

    expect(screen.getByText(/0\.62h/)).toBeTruthy();
    expect(screen.queryByText(/clock kept running/)).toBeNull();
    // It still has to say SOMETHING true about why the total moved.
    expect(screen.getByText(/already had time on it/)).toBeTruthy();
  });

  it("discloses a 30–54s hold banked after the freeze", async () => {
    // 0.01h spans 18s–54s and the 30s ledger gate sits inside it, so the
    // rounded hours can't prove a row exists. The server knows, and now says so.
    saveTimerAction.mockResolvedValue(
      result({
        workHours: 0.31,
        totalHours: 0.31,
        waitPartsHours: 0.01,
        waitPartsLedgered: true,
      }),
    );
    const { rerender } = renderSlots();
    await openAndSave();

    await waitFor(() =>
      expect(screen.getByText(/0\.01h waiting on parts/)).toBeTruthy(),
    );
    deliverRevalidatedProps(rerender);
    expect(screen.getByText(/0\.01h waiting on parts/)).toBeTruthy();
  });

  it("closes out silently when nothing diverged", async () => {
    saveTimerAction.mockResolvedValue(
      result({ workHours: 0.31, totalHours: 0.31 }),
    );
    const { rerender } = renderSlots();
    await openAndSave();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    deliverRevalidatedProps(rerender);
    expect(screen.queryByText(/^Saved$/)).toBeNull();
    expect(screen.queryByText(/save & close timer/i)).toBeNull();
  });
});
