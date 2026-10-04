// @vitest-environment jsdom
//
// The light 1-2h "How long did the X take?" chip row. Drives the real LogRoForm
// (real retro-capture, mocked server actions) because the failure shape this
// feature is prone to is "the logic is right and the tech never sees it": a
// gate that is never wired to the page, or state that survives Save & New.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { LogRoForm } from "./LogRoForm";
import type { Entry, EntryOpCode } from "@/lib/types";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}));

function mkLine(over: Partial<EntryOpCode>): EntryOpCode {
  return {
    id: "l1",
    opCodeId: null,
    custom: true,
    customCode: "ALIGN",
    customDescription: "Alignment",
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
    ...over,
  };
}
function mkEntry(lines: EntryOpCode[]): Entry {
  return {
    id: "e1",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-10-04",
    roNumber: "12345",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
  };
}

let nextSaved: Entry = mkEntry([mkLine({})]);
const saveEntry = vi.fn(async (...a: unknown[]) => (void a, nextSaved));
const setLineActualHoursAction = vi.fn(
  async (...a: unknown[]): Promise<{ error?: string }> => (void a, {}),
);
vi.mock("@/app/actions/entries", () => ({
  saveEntry: (...a: unknown[]) => saveEntry(...a),
  findDuplicateRos: vi.fn(async () => []),
  deleteEntryAction: vi.fn(),
  setLineActualHoursAction: (...a: unknown[]) => setLineActualHoursAction(...a),
  getRoMatchById: vi.fn(async () => null),
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
vi.mock("@/app/actions/open-tickets", () => ({
  findOpenRoAction: vi.fn(async () => []),
  createOpenEntryAction: vi.fn(async () => ({})),
  updateOpenEntryAction: vi.fn(async () => ({})),
  closeTicketAction: vi.fn(async () => ({})),
  getCloseDefaultsAction: vi.fn(async () => {
    throw new Error("not used");
  }),
}));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  routerPush.mockClear();
  nextSaved = mkEntry([mkLine({})]);
});
afterEach(() => vi.useRealTimers());

function typeRo(value: string) {
  const input = document.getElementById("ro-number") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no button labelled "${label}"`);
  return btn as HTMLButtonElement;
}
function firstChip() {
  return document.querySelector(".log-light button.log-chip") as HTMLButtonElement;
}
async function saveAndNew(ro: string) {
  typeRo(ro);
  await act(async () => {
    button("Save & New").click();
  });
}
const ASK = /How long did the ALIGN take\?/;

describe("LogRoForm: light 1-2h retro row", () => {
  it("shows for an opted-in fresh save with a 1.5h line", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    expect(screen.getByText(/RO #12345 saved/)).toBeTruthy();
    expect(screen.getByText(ASK)).toBeTruthy();
    expect(button("Skip")).toBeTruthy();
    // Inline, not a modal.
    expect(document.querySelector(".modal-panel")).toBeNull();
    expect(document.querySelectorAll(".log-light button.log-chip").length).toBeLessThanOrEqual(6);
  });

  it("is hidden when the tech has not opted in", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes={false} />);
    await saveAndNew("12345");
    expect(screen.getByText(/RO #12345 saved/)).toBeTruthy();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("is hidden in guest mode (custom onSave, no persisted row)", async () => {
    const onSave = vi.fn();
    render(
      <LogRoForm initialOpCodes={[]} roTemplates={[]} onSave={onSave} shareLaborTimes={false} />,
    );
    await saveAndNew("12345");
    expect(onSave).toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("is hidden even with the flag on if the form has a custom onSave", async () => {
    // Belt and braces: a custom onSave never gets a persisted entry back.
    const onSave = vi.fn();
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} onSave={onSave} shareLaborTimes />);
    await saveAndNew("12345");
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("is hidden in edit mode", async () => {
    render(
      <LogRoForm
        initialOpCodes={[]}
        roTemplates={[]}
        existingEntry={mkEntry([mkLine({})])}
        shareLaborTimes
      />,
    );
    await act(async () => {
      button("Save Changes").click();
    });
    expect(saveEntry).toHaveBeenCalled();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("is hidden when the 2h+ modal fires for the same save (one ask per save)", async () => {
    nextSaved = mkEntry([
      mkLine({ id: "big", customCode: "WP", flagHours: 3 }),
      mkLine({ id: "mid", flagHours: 1.5, position: 1 }),
    ]);
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    expect(screen.getByText("How long did that take?")).toBeTruthy();
    expect(screen.queryByText(ASK)).toBeNull();
    // Dismissing the modal finishes Save & New; still no second ask.
    await act(async () => {
      button("Skip").click();
    });
    expect(screen.getByText(/RO #12345 saved/)).toBeTruthy();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("a chip tap writes an estimate for that line and collapses to a confirmation", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    await act(async () => {
      firstChip().click();
    });
    expect(setLineActualHoursAction).toHaveBeenCalledTimes(1);
    const [lineId, hours, source, opts] = setLineActualHoursAction.mock.calls[0];
    // Guarded: a timer's hours must never be overwritten by a stale guess.
    expect(opts).toEqual({ onlyIfEmpty: true });
    expect(lineId).toBe("l1");
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(3);
    expect(source).toBe("estimate");
    expect(screen.getByText(new RegExp(`^Saved ${hours}h for ALIGN$`))).toBeTruthy();
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("a skipped write (line got timed meanwhile) closes quietly with no confirmation", async () => {
    setLineActualHoursAction.mockResolvedValueOnce({ skipped: true } as { error?: string });
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    await act(async () => {
      firstChip().click();
    });
    expect(screen.queryByText(ASK)).toBeNull();
    expect(screen.queryByText(/^Saved .*h for/)).toBeNull();
  });

  it("a failed write just closes the row; nothing traps the tech", async () => {
    setLineActualHoursAction.mockRejectedValueOnce(new Error("boom"));
    vi.useFakeTimers();
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    await act(async () => {
      firstChip().click();
    });
    expect(screen.queryByText(ASK)).toBeNull();
    expect(screen.queryByText(/^Saved .*h for/)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/RO #12345 saved/)).toBeNull();
  });

  it("Skip removes the row without writing anything", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    await act(async () => {
      button("Skip").click();
    });
    expect(screen.queryByText(ASK)).toBeNull();
    expect(setLineActualHoursAction).not.toHaveBeenCalled();
  });

  it("resets per save: the next RO gets a fresh row and the old one does not leak", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("11111");
    await act(async () => {
      firstChip().click();
    });
    expect(screen.getByText(/^Saved .*h for ALIGN$/)).toBeTruthy();

    // Second save in the SAME mounted form: a different line, a fresh ask.
    nextSaved = mkEntry([mkLine({ id: "l2", customCode: "BRAKES", flagHours: 1.25 })]);
    await saveAndNew("22222");
    expect(screen.queryByText(/^Saved .*h for ALIGN$/)).toBeNull();
    expect(screen.getByText(/How long did the BRAKES take\?/)).toBeTruthy();
    expect(document.querySelectorAll(".log-light button.log-chip").length).toBeGreaterThan(0);
  });

  it("starting the next RO (typing) removes an unanswered row", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    expect(screen.getByText(ASK)).toBeTruthy();
    typeRo("2");
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it("the strip outlives the usual 3.5s while the ask is open", async () => {
    vi.useFakeTimers();
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await saveAndNew("12345");
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(ASK)).toBeTruthy();
  });
});

describe("LogRoForm: plain Save RO leaves a one-shot pointer for the dashboard", () => {
  async function plainSave(ro: string) {
    typeRo(ro);
    await act(async () => {
      button("Save RO").click();
    });
  }

  it("pushes /dashboard?ask=<lineId> immediately, for an opted-in 1.5h save", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await plainSave("12345");
    // Immediately: no timer was advanced and nothing was awaited past the save.
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/dashboard?ask=l1");
  });

  it("pushes plain /dashboard when not opted in", async () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes={false} />);
    await plainSave("12345");
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });

  it("pushes plain /dashboard when the line is outside the 1-2h band", async () => {
    nextSaved = mkEntry([mkLine({ flagHours: 0.8 })]);
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await plainSave("12345");
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });

  it("when the 2h+ modal fires there is no pointer, before or after it closes", async () => {
    nextSaved = mkEntry([
      mkLine({ id: "big", customCode: "WP", flagHours: 3 }),
      mkLine({ id: "mid", flagHours: 1.5, position: 1 }),
    ]);
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} shareLaborTimes />);
    await plainSave("12345");
    expect(routerPush).not.toHaveBeenCalled();
    await act(async () => {
      button("Skip").click();
    });
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });

  it("a non-dashboard redirectTo is left untouched", async () => {
    render(
      <LogRoForm initialOpCodes={[]} roTemplates={[]} redirectTo="/history" shareLaborTimes />,
    );
    await plainSave("12345");
    expect(routerPush).toHaveBeenCalledWith("/history");
  });

  it("edit mode never carries the pointer", async () => {
    render(
      <LogRoForm
        initialOpCodes={[]}
        roTemplates={[]}
        existingEntry={mkEntry([mkLine({})])}
        shareLaborTimes
      />,
    );
    await act(async () => {
      button("Save Changes").click();
    });
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });
});
