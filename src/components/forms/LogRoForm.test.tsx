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
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
vi.mock("@/lib/retro-capture", () => ({ retroCandidates: () => [] }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

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
