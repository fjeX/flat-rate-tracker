// @vitest-environment jsdom
//
// Regression cover for the "Reset to unpaid" control, which had no test at all
// — which is exactly why the one broken layer was the UI layer. The data layer
// and the server action were both covered and both correct.
//
// THE BUG, as observed against the real component:
//
//   KEYBOARD (edit the field, Tab to the button, press Enter)
//     calls = "upsert:2026-08-P1:70 | upsert-done:70"   <-- no delete at all
//   MOUSE (edit the field, mousedown + click the button)
//     calls = "delete:2026-08-P1 | delete-done"          <-- correct
//
// Tabbing off the input fired its onBlur commit, which saved the very figure
// the user was about to erase; that commit ran in the same useTransition as the
// reset, so `disabled={isPending}` disabled the button WHILE THE USER'S FOCUS
// WAS ON IT and swallowed the Enter. The `onMouseDown={preventDefault}` guard
// defended exactly one input modality.
//
// WHY THESE TESTS DRIVE THE COMPONENT AND NOT THE ACTION:
// lib/db/paid-periods and the server action have their own tests and neither
// can fail on this — no wrong value was ever computed or written. The defect
// was which write got issued, and by which input modality. Only the rendered,
// focus-managed component can prove that.
//
// HOW A KEYBOARD PRESS IS SIMULATED: jsdom implements neither Tab navigation
// nor a button's default activation behaviour, so both are spelled out. Tab is
// `button.focus()` — jsdom does fire blur on the input with relatedTarget set
// to the button, which is the browser behaviour the fix reads. Enter is a
// keydown followed by the click a real browser synthesises from it; React
// declines to deliver a click to a disabled button, which is how the swallowed
// keypress reproduces here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { Stats } from "@/lib/stats";

// --- action mocks: they record the exact call ORDER, which is the whole point.
const calls: string[] = [];

/** A save the test decides when to finish, so activation happens in-flight. */
let releaseSave: (() => void) | null = null;

const setPaidPeriodHoursAction = vi.fn(
  async (periodKey: string, hours: number) => {
    calls.push(`upsert:${periodKey}:${hours}`);
    await new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    calls.push(`upsert-done:${hours}`);
    return { error: null as string | null };
  },
);

const deletePaidPeriodAction = vi.fn(async (periodKey: string) => {
  calls.push(`delete:${periodKey}`);
  calls.push("delete-done");
  return { error: null as string | null };
});

vi.mock("@/app/actions/paid-periods", () => ({
  setPaidPeriodHoursAction: (...a: [string, number]) =>
    setPaidPeriodHoursAction(...a),
  deletePaidPeriodAction: (...a: [string]) => deletePaidPeriodAction(...a),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

// Imported after the mocks so the component picks them up.
import { DiscrepancyCard } from "./DiscrepancyCard";

const PERIOD = "2026-08-P1";

const STATS: Stats = {
  flagHours: 80,
  clockedHours: 80,
  efficiency: 100,
  roCount: 12,
  actualHours: 0,
  unpaidHours: 0,
  comebackHours: 0,
  waitingHours: 0,
  shopHours: 0,
  upsellHours: 0,
};

function setup(initialPaid: number | null = 65) {
  return render(
    <>
      <DiscrepancyCard
        periodKey={PERIOD}
        stats={STATS}
        initialPaid={initialPaid}
      />
      {/* A real, focusable "somewhere else" so blur carries a relatedTarget
          that is NOT the reset button — the control case. */}
      <button type="button">elsewhere</button>
    </>,
  );
}

const field = () =>
  screen.getByRole("spinbutton") as HTMLInputElement;
const resetBtn = () =>
  screen.getByRole("button", { name: "Reset to unpaid" }) as HTMLButtonElement;
const elsewhere = () =>
  screen.getByRole("button", { name: "elsewhere" }) as HTMLButtonElement;

/** Type a new figure into the paid-hours field. */
function edit(value: string) {
  fireEvent.change(field(), { target: { value } });
}

/**
 * What a browser does when you Tab from the field onto `to`: blur the field
 * with relatedTarget set, then focus the target.
 */
function tabTo(to: HTMLElement) {
  act(() => {
    field().focus();
    to.focus();
  });
}

/**
 * What a browser does when you press Enter (or Space) on a focused button:
 * the keydown, then the click it synthesises as the default action. React
 * refuses to deliver a click to a disabled button, so a control that has gone
 * disabled under the user's fingers swallows the press here exactly as it does
 * in the browser.
 */
function pressActivate(btn: HTMLButtonElement, key: "Enter" | " " = "Enter") {
  fireEvent.keyDown(btn, { key });
  fireEvent.click(btn);
}

beforeEach(() => {
  calls.length = 0;
  releaseSave = null;
  refresh.mockClear();
  setPaidPeriodHoursAction.mockClear();
  deletePaidPeriodAction.mockClear();
  // jsdom's window.confirm throws "not implemented". The guard is deliberate
  // product behaviour, so it stays in the component and gets answered here.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Reset to unpaid — every input modality", () => {
  it("keyboard: Tab onto the control and press Enter → one delete, zero upserts", async () => {
    setup(65);

    // The user corrects the figure, then decides to clear it instead.
    edit("70");
    tabTo(resetBtn());

    await act(async () => {
      pressActivate(resetBtn());
    });

    expect(calls).toEqual([`delete:${PERIOD}`, "delete-done"]);
    expect(setPaidPeriodHoursAction).not.toHaveBeenCalled();
    expect(deletePaidPeriodAction).toHaveBeenCalledTimes(1);
  });

  it("keyboard: the control does not go disabled under the user's fingers", () => {
    setup(65);
    edit("70");
    tabTo(resetBtn());

    // The mechanism, asserted directly. A save transition started by the
    // Tab-blur used to flip `disabled` while focus was already on the button,
    // so the Enter that followed reached nothing.
    expect(document.activeElement).toBe(resetBtn());
    expect(resetBtn().disabled).toBe(false);
  });

  it("keyboard: Space activates it the same way", async () => {
    setup(65);
    edit("70");
    tabTo(resetBtn());

    await act(async () => {
      pressActivate(resetBtn(), " ");
    });

    expect(calls).toEqual([`delete:${PERIOD}`, "delete-done"]);
    expect(setPaidPeriodHoursAction).not.toHaveBeenCalled();
  });

  it("mouse: mousedown + click still deletes and never upserts", async () => {
    setup(65);
    edit("70");

    // jsdom never moves focus on mousedown, so this cannot prove the
    // preventDefault guard itself — what it pins is that the mouse path, the
    // one that already worked, still issues exactly one delete.
    act(() => {
      field().focus();
    });
    fireEvent.mouseDown(resetBtn());
    await act(async () => {
      fireEvent.click(resetBtn());
    });

    expect(calls).toEqual([`delete:${PERIOD}`, "delete-done"]);
    expect(setPaidPeriodHoursAction).not.toHaveBeenCalled();
  });

  it("mouse, shorter fuse: a click during an in-flight save is not swallowed", async () => {
    setup(65);
    edit("70");

    // Blur somewhere ordinary — that save is now in the air and stays there.
    tabTo(elsewhere());
    expect(calls).toEqual([`upsert:${PERIOD}:70`]);

    await act(async () => {
      fireEvent.mouseDown(resetBtn());
      fireEvent.click(resetBtn());
    });

    // The delete is issued, and it is issued AFTER the save it was racing —
    // otherwise the upsert lands second and puts the row straight back.
    await act(async () => {
      releaseSave?.();
    });
    expect(calls).toEqual([
      `upsert:${PERIOD}:70`,
      "upsert-done:70",
      `delete:${PERIOD}`,
      "delete-done",
    ]);
  });
});

describe("the control case — an ordinary blur still saves", () => {
  // Without this, "no upsert on the keyboard path" would pass just as happily
  // if commit() were broken outright. This is the locator proving the same
  // blur can reach the save at all.
  it("blur to somewhere that is NOT the reset button commits the figure", async () => {
    setup(65);
    edit("70");

    tabTo(elsewhere());

    expect(calls).toEqual([`upsert:${PERIOD}:70`]);
    expect(setPaidPeriodHoursAction).toHaveBeenCalledWith(PERIOD, 70);
    expect(deletePaidPeriodAction).not.toHaveBeenCalled();

    await act(async () => {
      releaseSave?.();
    });
  });

  it("tabbing PAST the reset button without pressing it still saves", async () => {
    setup(65);
    edit("70");

    tabTo(resetBtn());
    expect(calls).toEqual([]); // suppressed on the way in…

    act(() => {
      elsewhere().focus();
    });
    expect(calls).toEqual([`upsert:${PERIOD}:70`]); // …and paid on the way out

    await act(async () => {
      releaseSave?.();
    });
  });
});

describe("a period with nothing saved yet still saves — the null-relatedTarget paths", () => {
  /**
   * The guard that fixed the keyboard bug was written as
   *
   *     if (e.relatedTarget === resetRef.current) return;
   *
   * and the reset button only renders once a figure is saved. So with nothing
   * saved, resetRef.current is null — and `null === null` is TRUE, which
   * skipped the save for every blur carrying no relatedTarget.
   *
   * Two of the three ways out of a field carry a null relatedTarget: pressing
   * Enter (a programmatic .blur(), which is exactly what this card's own
   * "Press enter or click away to save" hint instructs) and clicking any
   * non-focusable space. Only Tab survived.
   *
   * That silently discarded the FIRST figure a tech ever types into a period —
   * the single most common use of this input — with no error shown. And a
   * successful reset returns the card to precisely that state, so the reset
   * feature handed the user the broken case as its normal outcome.
   *
   * The existing suite could not see it: nearly every case starts from a saved
   * value, and every save assertion leaves the field by Tab.
   */
  it("saves on Enter when no figure is saved yet", async () => {
    setup(null);
    // The field must really hold focus: the handler below calls .blur(), and
    // in jsdom (as in a browser) blurring an unfocused element does nothing.
    field().focus();
    edit("70");

    // Enter is handled by the card's own onKeyDown, which calls .blur() —
    // a programmatic blur, so relatedTarget is null in every browser.
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(calls).toEqual([`upsert:${PERIOD}:70`]);
    expect(setPaidPeriodHoursAction).toHaveBeenCalledWith(PERIOD, 70);

    await act(async () => {
      releaseSave?.();
    });
  });

  it("saves when focus leaves to nothing focusable", async () => {
    setup(null);
    edit("70");

    // Clicking the card body, the page background, or iOS's keyboard "Done".
    fireEvent.blur(field(), { relatedTarget: null });

    expect(calls).toEqual([`upsert:${PERIOD}:70`]);

    await act(async () => {
      releaseSave?.();
    });
  });

  it("suppression still works when the button IS rendered — the control", async () => {
    // Pairs with the two above. They assert a save HAPPENS on a null
    // relatedTarget; this asserts the suppression it replaced still fires on a
    // real one. Without it, "saves now" could pass by deleting the guard
    // outright and reopening the keyboard bug.
    setup(65);
    edit("70");

    tabTo(resetBtn());

    expect(calls).toEqual([]);

    await act(async () => {
      releaseSave?.();
    });
  });
});

describe("the control is only there when there is something to clear", () => {
  it("is absent when no paid figure is saved", () => {
    setup(null);
    expect(
      screen.queryByRole("button", { name: "Reset to unpaid" }),
    ).toBeNull();
    // The locator is not vacuous — it finds the button when one exists.
    cleanup();
    setup(65);
    expect(
      screen.queryByRole("button", { name: "Reset to unpaid" }),
    ).not.toBeNull();
  });
});

describe("repaint contract", () => {
  // The hero above this card and the period `mode` are server props. A local
  // clear with no refetch leaves the Settled hero showing the old figure over a
  // discrepancy card reading "—". Every comparable write in this codebase does
  // refresh → FLUSH_EVENT → notifyDataChanged; see BonusForm, SpiffsCard,
  // QuickAddModal and PeriodHero.AwaitingPay, which writes this same table.
  it("a successful reset refetches the server tree and flushes the paint", async () => {
    const flushed = vi.fn();
    window.addEventListener("frt:flush-refresh", flushed);
    setup(65);

    await act(async () => {
      fireEvent.click(resetBtn());
    });

    expect(refresh).toHaveBeenCalled();
    expect(flushed).toHaveBeenCalled();
    window.removeEventListener("frt:flush-refresh", flushed);
  });

  it("a successful save does too", async () => {
    const flushed = vi.fn();
    window.addEventListener("frt:flush-refresh", flushed);
    setup(65);
    edit("70");
    tabTo(elsewhere());

    await act(async () => {
      releaseSave?.();
    });

    expect(refresh).toHaveBeenCalled();
    expect(flushed).toHaveBeenCalled();
    window.removeEventListener("frt:flush-refresh", flushed);
  });
});
