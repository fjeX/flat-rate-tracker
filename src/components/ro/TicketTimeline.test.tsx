// @vitest-environment jsdom
//
// timeline-form-no-reset-on-open (2026-09-13): both add-forms kept their fields
// in state that "collapsing" never cleared — the collapsed view was an early
// return, not an unmount — so a time typed for one event rode onto the next
// one, and hours meant for today landed on yesterday's date.
//
// TicketTimeline only lives inside RoDetailModal, which stays mounted for the
// whole RO session, so these tests NEVER unmount the component between opens.
// A test that re-rendered a fresh TicketTimeline would pass against the broken
// code and prove nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Entry, RoEvent } from "@/lib/types";

const TODAY = "2026-09-13";

const EVENTS: RoEvent[] = [
  {
    id: "ev-1",
    userId: "u1",
    entryId: "entry-1",
    date: "2026-09-10",
    time: null,
    kind: "opened",
    note: "",
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
  },
];

const addRoEventAction = vi.fn(async (_input: unknown) => ({}) as { error?: string });
const addOpenWorkAction = vi.fn(async (_input: unknown) => ({}) as { error?: string });
const getTicketTimelineAction = vi.fn(async () => ({ events: EVENTS, ledger: [] }));

vi.mock("@/app/actions/open-tickets", () => ({
  addOpenWorkAction: (input: unknown) => addOpenWorkAction(input),
  addRoEventAction: (input: unknown) => addRoEventAction(input),
  deleteOpenWorkAction: vi.fn(),
  deleteRoEventAction: vi.fn(),
  getTicketTimelineAction: () => getTicketTimelineAction(),
  reopenTicketAction: vi.fn(),
}));

import { TicketTimeline } from "./TicketTimeline";

const entry = {
  id: "entry-1",
  userId: "u1",
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z",
  date: "2026-09-10",
  roNumber: "91630",
  vehicle: { year: "2019", make: "Ford", model: "F-250", vin: "", mileage: "" },
  opCodes: [],
  flagHours: 0,
  notes: "",
  status: "open",
} as unknown as Entry;

/** Mount once, wait for the timeline load to settle. Never remount after this. */
async function mountTimeline() {
  const utils = render(<TicketTimeline entry={entry} onChanged={() => {}} />);
  await screen.findByTestId("ticket-timeline");
  return utils;
}

function q<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel) as T | null;
  if (!el) throw new Error(`no element for ${sel}`);
  return el;
}

function button(label: string) {
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no button labelled "${label}"`);
  return btn as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

function set(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 8, 13, 17, 30, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TicketTimeline — add-event form resets every time it opens", () => {
  it("comes back to defaults after a save and reopen", async () => {
    await mountTimeline();

    await click(screen.getByTestId("add-event-open"));
    set(q("select"), "parts_ordered");
    set(q('input[type="date"]'), "2026-09-01");
    set(q('input[type="time"]'), "14:45");
    set(q('input[type="text"]'), "ordered the pump");

    await click(button("Add event"));
    await waitFor(() => expect(addRoEventAction).toHaveBeenCalledTimes(1));
    // The first save really did carry what was typed.
    expect(addRoEventAction.mock.calls[0][0]).toMatchObject({
      kind: "parts_ordered",
      date: "2026-09-01",
      time: "14:45",
      note: "ordered the pump",
    });
    // Form closed itself.
    await waitFor(() => expect(screen.getByTestId("add-event-open")).toBeTruthy());

    // --- Second open, same mounted component.
    await click(screen.getByTestId("add-event-open"));
    expect(q<HTMLSelectElement>("select").value).toBe("diag_done");
    expect(q<HTMLInputElement>('input[type="date"]').value).toBe(TODAY);
    expect(q<HTMLInputElement>('input[type="time"]').value).toBe("");
    expect(q<HTMLInputElement>('input[type="text"]').value).toBe("");

    // And a save made now sends the defaults, not the previous open's values.
    await click(button("Add event"));
    await waitFor(() => expect(addRoEventAction).toHaveBeenCalledTimes(2));
    expect(addRoEventAction.mock.calls[1][0]).toMatchObject({
      kind: "diag_done",
      date: TODAY,
      time: null,
      note: "",
    });
  });

  it("comes back to defaults after Cancel and reopen", async () => {
    await mountTimeline();

    await click(screen.getByTestId("add-event-open"));
    set(q("select"), "hold_parts");
    set(q('input[type="date"]'), "2026-08-20");
    set(q('input[type="time"]'), "07:15");
    set(q('input[type="text"]'), "left a message");

    await click(button("Cancel"));
    expect(addRoEventAction).not.toHaveBeenCalled();

    await click(screen.getByTestId("add-event-open"));
    expect(q<HTMLSelectElement>("select").value).toBe("diag_done");
    expect(q<HTMLInputElement>('input[type="date"]').value).toBe(TODAY);
    expect(q<HTMLInputElement>('input[type="time"]').value).toBe("");
    expect(q<HTMLInputElement>('input[type="text"]').value).toBe("");
  });
});

describe("TicketTimeline — add-hours form resets every time it opens", () => {
  it("comes back to defaults after a save and reopen", async () => {
    await mountTimeline();

    await click(screen.getByTestId("add-hours-open"));
    set(q('input[type="date"]'), "2026-09-11");
    set(screen.getByTestId("add-hours-input"), "3.5");
    set(q('input[type="text"]'), "teardown");

    await click(screen.getByTestId("add-hours-save"));
    await waitFor(() => expect(addOpenWorkAction).toHaveBeenCalledTimes(1));
    expect(addOpenWorkAction.mock.calls[0][0]).toMatchObject({
      date: "2026-09-11",
      hours: 3.5,
      note: "teardown",
    });
    await waitFor(() => expect(screen.getByTestId("add-hours-open")).toBeTruthy());

    await click(screen.getByTestId("add-hours-open"));
    // The bug that bit tonight: yesterday's date riding into today's entry.
    expect(q<HTMLInputElement>('input[type="date"]').value).toBe(TODAY);
    expect((screen.getByTestId("add-hours-input") as HTMLInputElement).value).toBe("");
    expect(q<HTMLInputElement>('input[type="text"]').value).toBe("");
    // Save is disabled again because hours is genuinely empty.
    expect((screen.getByTestId("add-hours-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("comes back to defaults after Cancel and reopen", async () => {
    await mountTimeline();

    await click(screen.getByTestId("add-hours-open"));
    set(q('input[type="date"]'), "2026-08-30");
    set(screen.getByTestId("add-hours-input"), "6");
    set(q('input[type="text"]'), "waiting room rebuild");

    await click(button("Cancel"));
    expect(addOpenWorkAction).not.toHaveBeenCalled();

    await click(screen.getByTestId("add-hours-open"));
    expect(q<HTMLInputElement>('input[type="date"]').value).toBe(TODAY);
    expect((screen.getByTestId("add-hours-input") as HTMLInputElement).value).toBe("");
    expect(q<HTMLInputElement>('input[type="text"]').value).toBe("");
  });
});

describe("TicketTimeline — a failed write's banner does not haunt the next open", () => {
  it("clears the error when the form is opened again", async () => {
    addRoEventAction.mockResolvedValueOnce({
      error: "That date is outside the ticket.",
    });
    await mountTimeline();

    await click(screen.getByTestId("add-event-open"));
    await click(button("Add event"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("outside the ticket"),
    );

    // The form stays open on a failure (the tech's typing is still on screen).
    await click(button("Cancel"));
    await click(screen.getByTestId("add-event-open"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
