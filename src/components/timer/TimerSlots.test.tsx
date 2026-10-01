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
const startTimerWithoutRoAction = vi.fn();
const attachRoToExistingTimerAction = vi.fn();
const attachRoToTimerAction = vi.fn();
const saveEntry = vi.fn();
vi.mock("@/app/actions/timer", () => ({
  saveTimerAction: (...args: unknown[]) => saveTimerAction(...args),
  startTimerWithoutRoAction: (...args: unknown[]) => startTimerWithoutRoAction(...args),
  attachRoToExistingTimerAction: (...args: unknown[]) =>
    attachRoToExistingTimerAction(...args),
  attachRoToTimerAction: (...args: unknown[]) => attachRoToTimerAction(...args),
  releaseTimerAction: vi.fn(),
  resetTimerAction: vi.fn(),
  setTimerLineAction: vi.fn(),
  setTimerStatusAction: vi.fn(),
}));
vi.mock("@/app/actions/entries", () => ({
  saveEntry: (...args: unknown[]) => saveEntry(...args),
}));
// The real form is heavy; a stand-in that just calls onSave is enough to drive
// the Log-a-new-RO path.
vi.mock("@/components/forms/LogRoForm", () => ({
  LogRoForm: ({ onSave }: { onSave: (input: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        onSave({}).catch(() => {});
      }}
    >
      Save new RO
    </button>
  ),
}));

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

// Product decision (Liem, 2026-09-30): a timer can run with no RO. Saving the
// time still needs an RO and a line.
describe("TimerSlots — a timer with no RO", () => {
  const NO_RO_SLOT: TimerSlot = {
    ...SLOT,
    entryId: null,
    lineId: null,
    status: "working",
    startTime: Date.now(),
    workAccumulated: 0.5 * 3_600_000,
  };

  function renderNoRo() {
    return render(
      <TimerSlots
        slots={[NO_RO_SLOT]}
        attachedEntries={[]}
        caps={{}}
        recentEntries={[ENTRY]}
        library={LIBRARY}
        roTemplates={[]}
      />,
    );
  }

  it("says 'No RO yet', guides with NEXT, and keeps Save disabled despite banked time", () => {
    renderNoRo();
    expect(screen.getByText("No RO yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^RO / })).toBeNull();
    expect(screen.getByText("Attach an RO to save these hours.")).toBeTruthy();
    const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Reset and Clear still work.
    expect((screen.getByRole("button", { name: /^reset$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /clear timer 1/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Attach RO opens the picker for this slot and binds the chosen RO to it", async () => {
    attachRoToExistingTimerAction.mockResolvedValue({});
    renderNoRo();
    fireEvent.click(screen.getByRole("button", { name: /^attach ro$/i }));
    await screen.findByText("Put an RO on a timer");
    // Not offered from a slot that is already running.
    expect(screen.queryByRole("button", { name: /start without an ro/i })).toBeNull();
    fireEvent.click(screen.getByText("#88421").closest("button")!);
    // One line on the RO: bound straight away, so nobody has to pick it.
    await waitFor(() =>
      expect(attachRoToExistingTimerAction).toHaveBeenCalledWith("t-1", "e-1", "line-1"),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the refusal an attach returns", async () => {
    attachRoToExistingTimerAction.mockResolvedValue({
      error: "That line of RO #88421 is already on a timer.",
    });
    renderNoRo();
    fireEvent.click(screen.getByRole("button", { name: /^attach ro$/i }));
    await screen.findByText("Put an RO on a timer");
    fireEvent.click(screen.getByText("#88421").closest("button")!);
    await screen.findByText("That line of RO #88421 is already on a timer.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers 'Start without an RO' from a free slot, even with no ROs to pick", async () => {
    startTimerWithoutRoAction.mockResolvedValue({});
    render(
      <TimerSlots
        slots={[]}
        attachedEntries={[]}
        caps={{}}
        recentEntries={[]}
        library={LIBRARY}
        roTemplates={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start a timer/i }));
    await screen.findByText("Put an RO on a timer");
    fireEvent.click(screen.getByRole("button", { name: /start without an ro/i }));
    await waitFor(() => expect(startTimerWithoutRoAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a refused attach keeps the target: Log-a-new-RO retry binds the same no-RO timer", async () => {
    attachRoToExistingTimerAction
      .mockResolvedValueOnce({ error: "This timer already has an RO." })
      .mockResolvedValueOnce({});
    saveEntry.mockResolvedValue({ id: "e-1", opCodes: [LINE] });
    renderNoRo();
    fireEvent.click(screen.getByRole("button", { name: /^attach ro$/i }));
    await screen.findByText("Put an RO on a timer");
    fireEvent.click(screen.getByRole("button", { name: /log a new ro/i }));
    const save = await screen.findByRole("button", { name: "Save new RO" });
    fireEvent.click(save);
    await waitFor(() => expect(attachRoToExistingTimerAction).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save new RO" }));
    await waitFor(() => expect(attachRoToExistingTimerAction).toHaveBeenCalledTimes(2));
    expect(attachRoToExistingTimerAction).toHaveBeenLastCalledWith("t-1", "e-1", "line-1");
    // Never fell through to claiming a new slot.
    expect(attachRoToTimerAction).not.toHaveBeenCalled();
  });
});
