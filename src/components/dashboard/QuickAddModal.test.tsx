// @vitest-environment jsdom
//
// Quick Add's duplicate check is async and nothing locks the RO field while it
// runs — only the Save button is disabled. So the tech can correct a typo while
// the check is in flight, and the answer that lands afterwards belongs to a
// number that is no longer on screen. These tests drive the real component and
// assert on what actually got SAVED, because "the guard is in the file" and
// "the guard runs" are different claims — the 2026-09-13 version of this same
// fix dropped the stale result and then fell through to the save anyway.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { QuickAddModal } from "./QuickAddModal";
import type { NewEntry, RoMatch } from "@/lib/types";

// Stable spies, not fresh vi.fn()s per render: "did it save, and with WHICH
// number?" is the assertion this whole file exists for.
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...a: unknown[]) => routerPush(...(a as [])),
    replace: vi.fn(),
    refresh: (...a: unknown[]) => routerRefresh(...(a as [])),
  }),
}));

const findDuplicateRos = vi.fn(async (): Promise<RoMatch[]> => []);
// Typed with its argument, not as a bare `vi.fn()`: the assertions below read
// the NewEntry back out of the recorded call, and an untyped spy records `[]`.
const saveEntry = vi.fn<(input: NewEntry) => Promise<unknown>>();
vi.mock("@/app/actions/entries", () => ({
  findDuplicateRos: (...a: unknown[]) => findDuplicateRos(...(a as [])),
  saveEntry: (...a: unknown[]) => saveEntry(...(a as [NewEntry])),
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));
// Spiff mode isn't under test and the form pulls in the bonus server actions at
// import time.
vi.mock("@/components/bonuses/BonusForm", () => ({
  BonusForm: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  findDuplicateRos.mockResolvedValue([]);
  saveEntry.mockResolvedValue({ id: "entry-1" });
  document.body.innerHTML = "";
});

const onClose = vi.fn();

function renderQuickAdd() {
  onClose.mockClear();
  render(
    <QuickAddModal library={[]} open onClose={onClose} />,
  );
}

/** Types into the RO field the way a browser does — native setter + input. */
function typeRo(value: string) {
  const input = document.getElementById(
    "quick-add-ro-number",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(label: string) {
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no button labelled "${label}"`);
  return btn;
}

/** The RO number the app actually wrote, from the saveEntry call. */
function savedRoNumbers(): string[] {
  return saveEntry.mock.calls.map((c) => c[0].roNumber);
}

const STALE_ABORT = /The RO number changed while FRT was checking it/i;
const MATCHES: RoMatch[] = [
  { id: "existing-1", date: "2026-09-18", vehicleSummary: "2021 Toyota Camry" },
];

describe("QuickAddModal — a duplicate check that lands late is inert", () => {
  // The reported bug, exactly: type 111 → Save → correct it to 222 while the
  // check runs → the check for 111 comes back CLEAN → the app saved 111 and
  // closed, with 222 on the screen the whole time.
  it("saves nothing when the RO number changed while the check was in flight", async () => {
    let resolveCheck!: (v: RoMatch[]) => void;
    findDuplicateRos.mockImplementation(
      () => new Promise<RoMatch[]>((res) => { resolveCheck = res; }),
    );

    renderQuickAdd();
    typeRo("111");

    await act(async () => {
      clickButton("Save RO").click();
    });

    // The premise: the field is NOT locked while the check runs. A tech must be
    // able to fix a typo. (If this ever becomes false, the race is gone and this
    // test is testing nothing.)
    expect(
      (document.getElementById("quick-add-ro-number") as HTMLInputElement)
        .disabled,
    ).toBe(false);

    // The correction, mid-flight.
    typeRo("222");

    // The clean verdict for 111 finally lands.
    await act(async () => {
      resolveCheck([]);
    });

    // The heart of it: an expired check is not permission to save. Ask what a
    // "proceeds" path would proceed WITH and the answer is 111 — the number the
    // tech had already replaced.
    expect(saveEntry).not.toHaveBeenCalled();
    // And no dialog, no close, no navigation — a save that didn't happen must
    // not look like one that did.
    expect(screen.queryByText(/already exists/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();

    // One honest sentence in the error slot the field already points at.
    expect(screen.getByText(STALE_ABORT).textContent).toMatch(/tap Save RO again/);
    // Still open, still editable, still holding the tech's number.
    expect(
      (document.getElementById("quick-add-ro-number") as HTMLInputElement).value,
    ).toBe("222");
  });

  // Same race, other branch: matches found. Without one guard placed ahead of
  // BOTH branches, this opens a dialog titled 222 listing entries for 111.
  it("opens no duplicate dialog when the late result names a number that moved", async () => {
    let resolveCheck!: (v: RoMatch[]) => void;
    findDuplicateRos.mockImplementation(
      () => new Promise<RoMatch[]>((res) => { resolveCheck = res; }),
    );

    renderQuickAdd();
    typeRo("111");
    await act(async () => {
      clickButton("Save RO").click();
    });
    typeRo("222");
    await act(async () => {
      resolveCheck(MATCHES);
    });

    expect(screen.queryByText(/already exists/i)).toBeNull();
    expect(saveEntry).not.toHaveBeenCalled();
    expect(screen.getByText(STALE_ABORT)).toBeTruthy();
  });

  // Control. The guard must not swallow the ordinary case — a modal that never
  // saves anything would pass every assertion above.
  it("saves exactly once, with that number, when the field never changed", async () => {
    renderQuickAdd();
    typeRo("111");

    await act(async () => {
      clickButton("Save RO").click();
    });

    expect(findDuplicateRos).toHaveBeenCalledWith("111");
    expect(savedRoNumbers()).toEqual(["111"]);
    expect(screen.queryByText(STALE_ABORT)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The dialog names the number that was CHECKED, and "Log as new entry" saves
  // that same number — so what it says and what it writes cannot diverge.
  it("shows the checked number in the duplicate dialog and saves it on 'log as new'", async () => {
    findDuplicateRos.mockResolvedValue(MATCHES);

    renderQuickAdd();
    typeRo("111");
    await act(async () => {
      clickButton("Save RO").click();
    });

    expect(screen.getByText("RO #111 already exists")).toBeTruthy();
    expect(saveEntry).not.toHaveBeenCalled();

    await act(async () => {
      clickButton("Log as new entry").click();
    });

    expect(savedRoNumbers()).toEqual(["111"]);
  });

  // Warn-but-allow means a FAILED check never blocks a save — but it must not
  // become a bypass either. A thrown check on a number that has since moved is
  // still a stale answer.
  it("does not save the old number when the check itself fails mid-edit", async () => {
    let rejectCheck!: (e: Error) => void;
    findDuplicateRos.mockImplementation(
      () => new Promise<RoMatch[]>((_res, rej) => { rejectCheck = rej; }),
    );

    renderQuickAdd();
    typeRo("111");
    await act(async () => {
      clickButton("Save RO").click();
    });
    typeRo("222");
    await act(async () => {
      rejectCheck(new Error("Database is unreachable."));
    });

    expect(saveEntry).not.toHaveBeenCalled();
    expect(screen.getByText(STALE_ABORT)).toBeTruthy();
  });

  // …and the other half of that pair: a failed check with the field untouched
  // still saves, because blocking on an unreachable duplicate lookup would stop
  // a tech logging work for a reason that has nothing to do with them.
  it("still saves when the check fails and the field never changed", async () => {
    findDuplicateRos.mockRejectedValue(new Error("Database is unreachable."));

    renderQuickAdd();
    typeRo("111");
    await act(async () => {
      clickButton("Save RO").click();
    });

    expect(savedRoNumbers()).toEqual(["111"]);
  });
});
