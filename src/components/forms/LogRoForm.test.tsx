// @vitest-environment jsdom
//
// The hook tests next door prove `abandonedRoNumber` gets set. They cannot
// prove the tech ever SEES it — a state field that no JSX reads is exactly the
// "real code that never runs" shape this project has been bitten by before. So
// this one drives the actual component and asserts on rendered text.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { LogRoForm } from "./LogRoForm";
import type { RoMatch } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const findDuplicateRos = vi.fn(async (): Promise<RoMatch[]> => []);
vi.mock("@/app/actions/entries", () => ({
  saveEntry: vi.fn(async () => ({ id: "entry-1", opCodes: [] })),
  findDuplicateRos: (...a: unknown[]) => findDuplicateRos(...(a as [])),
  deleteEntryAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
  // Edit-load resolves comebackOfEntryId to its original for the redo-of label.
  getRoMatchById: vi.fn(async () => null),
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
const findOpenRoAction = vi.fn(async (): Promise<unknown[]> => []);
const createOpenEntryAction = vi.fn(async (): Promise<{ error?: string }> => ({}));
vi.mock("@/app/actions/open-tickets", () => ({
  findOpenRoAction: (...a: unknown[]) => findOpenRoAction(...(a as [])),
  createOpenEntryAction: (...a: unknown[]) => createOpenEntryAction(...(a as [])),
  updateOpenEntryAction: vi.fn(async () => ({})),
  closeTicketAction: vi.fn(async () => ({})),
  getCloseDefaultsAction: vi.fn(async () => {
    throw new Error("not used");
  }),
}));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
vi.mock("@/lib/retro-capture", () => ({ retroCandidates: () => [] }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  findOpenRoAction.mockResolvedValue([]);
  createOpenEntryAction.mockResolvedValue({});
});

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

function clickButton(label: string) {
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no button labelled "${label}"`);
  return btn;
}

describe("LogRoForm — backing out of the duplicate prompt", () => {
  it("tells the tech on screen that the RO was not saved", async () => {
    findDuplicateRos.mockResolvedValue([
      { id: "existing-1", date: "2026-07-26", vehicleSummary: "2021 Toyota Camry" },
    ]);

    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} checkDuplicates />);

    typeRo("55102");

    // Control: nothing claims the RO is unsaved before anything is attempted.
    expect(screen.queryByText(/Not saved/i)).toBeNull();

    await act(async () => {
      clickButton("Save RO").click();
    });

    // The prompt is up and the save is deferred behind it.
    expect(findDuplicateRos).toHaveBeenCalledWith("55102");
    // Still nothing — the prompt itself is the message at this point.
    expect(screen.queryByText(/Not saved/i)).toBeNull();

    // Dismiss it the way a tech would: the modal's close control.
    await act(async () => {
      screen.getByRole("button", { name: "Close" }).click();
    });

    const notice = screen.getByText(/Not saved/i);
    expect(notice.textContent).toContain("55102");
    expect(notice.textContent).toMatch(/already exists/i);
  });

  it("says the same thing when the prompt is dismissed with Escape", async () => {
    findDuplicateRos.mockResolvedValue([
      { id: "existing-1", date: "2026-07-26", vehicleSummary: "2021 Toyota Camry" },
    ]);

    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} checkDuplicates />);
    typeRo("55102");
    await act(async () => {
      clickButton("Save RO").click();
    });

    // Escape is a separate dismiss route through the same handler. It gets its
    // own test because "every path funnels to onClose" is a claim about code
    // that can quietly stop being true.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(screen.getByText(/Not saved/i).textContent).toContain("55102");
  });
});

// ---------------------------------------------------------------------------

function stepNumbers() {
  return Array.from(document.querySelectorAll(".step-num")).map((el) =>
    el.textContent?.trim(),
  );
}

/** Renders a NEW RO with the open-ticket toggle flipped on. */
function renderOpenTicketForm() {
  render(<LogRoForm initialOpCodes={[]} roTemplates={[]} openTicketEnabled />);
  act(() => {
    screen
      .getByRole("switch", { name: "Open ticket — no op codes yet" })
      .click();
  });
}

describe("LogRoForm — the 'already open' warning is retracted, not just defanged", () => {
  const OPEN_WARNING = /is already open/i;

  it("clears the sentence when the RO number changes, not just the buttons", async () => {
    findOpenRoAction.mockResolvedValue([
      { id: "open-1", roNumber: "71801", status: "open", opCodes: [] },
    ]);

    renderOpenTicketForm();
    typeRo("71801");

    await act(async () => {
      clickButton("Open ticket").click();
    });

    // The warning names the RO the tech typed.
    expect(screen.getByText(OPEN_WARNING).textContent).toContain("71801");
    expect(screen.queryByText("View open ticket")).not.toBeNull();

    // A different number is a different question.
    typeRo("71802");

    // The buttons going away was never the bug — the SENTENCE staying was.
    expect(screen.queryByText("View open ticket")).toBeNull();
    expect(screen.queryByText(OPEN_WARNING)).toBeNull();
  });

  it("leaves an unrelated save failure on screen when the RO number changes", async () => {
    createOpenEntryAction.mockResolvedValue({ error: "Database is unreachable." });

    renderOpenTicketForm();
    typeRo("71801");

    await act(async () => {
      clickButton("Open ticket").click();
    });

    expect(screen.getByText("Database is unreachable.")).toBeTruthy();

    // Editing the number must not swallow a failure the tech hasn't read.
    typeRo("71802");

    expect(screen.getByText("Database is unreachable.")).toBeTruthy();
  });
});

describe("LogRoForm — step numbers count the steps that actually render", () => {
  it("numbers an ordinary RO 1, 2, 3, 4", () => {
    render(<LogRoForm initialOpCodes={[]} roTemplates={[]} />);
    expect(stepNumbers()).toEqual(["1", "2", "3", "4"]);
  });

  it("numbers a ticket 1, 2, 3 — the op-code step is not rendered, so it is not counted", () => {
    renderOpenTicketForm();
    // Not 1, 3, 4: a missing step must not leave a hole in the numbering.
    expect(stepNumbers()).toEqual(["1", "2", "3"]);
  });
});
