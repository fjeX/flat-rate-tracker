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
import type { Entry, RoMatch } from "@/lib/types";

// One stable spy, not a fresh vi.fn() per render: "did the form navigate away
// as though the save worked?" is an assertion, and a throwaway mock can't be
// asserted on.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...a: unknown[]) => routerPush(...(a as [])),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
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
const closeTicketAction = vi.fn<(input: unknown) => Promise<{ error?: string }>>(
  async () => ({}),
);
const getCloseDefaultsAction = vi.fn<(id: string) => Promise<unknown>>(async () => {
  throw new Error("not used");
});
vi.mock("@/app/actions/open-tickets", () => ({
  findOpenRoAction: (...a: unknown[]) => findOpenRoAction(...(a as [])),
  createOpenEntryAction: (...a: unknown[]) => createOpenEntryAction(...(a as [])),
  updateOpenEntryAction: vi.fn(async () => ({})),
  closeTicketAction: (input: unknown) => closeTicketAction(input),
  getCloseDefaultsAction: (id: string) => getCloseDefaultsAction(id),
}));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
vi.mock("@/lib/retro-capture", () => ({ retroCandidates: () => [] }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  findOpenRoAction.mockResolvedValue([]);
  createOpenEntryAction.mockResolvedValue({});
  closeTicketAction.mockResolvedValue({});
  getCloseDefaultsAction.mockRejectedValue(new Error("not used"));
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
  const STALE_ABORT = /The RO number changed while FRT was checking it/i;

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

  // The residual found by adversarial verification of the onChange fix: the
  // open-check is async and nothing cancels it. Clearing the warning on every
  // keystroke doesn't help if the warning is POSTED after the keystroke.
  it("drops an open-check result that lands after the tech retyped the number", async () => {
    let resolveCheck!: (v: unknown[]) => void;
    findOpenRoAction.mockImplementation(
      () => new Promise<unknown[]>((res) => { resolveCheck = res; }),
    );

    renderOpenTicketForm();
    typeRo("71801");

    await act(async () => {
      clickButton("Open ticket").click();
    });

    // Still in flight: no verdict yet, and the field is NOT locked — a tech
    // must be able to fix a typo while the check runs.
    expect(screen.queryByText(OPEN_WARNING)).toBeNull();
    expect((document.getElementById("ro-number") as HTMLInputElement).disabled).toBe(false);

    // The typo correction, mid-flight.
    typeRo("71802");

    // The answer for the OLD number finally lands.
    await act(async () => {
      resolveCheck([{ id: "open-1", roNumber: "71801", status: "open", opCodes: [] }]);
    });

    // Nothing about 71801 may appear over a field that reads 71802 — neither
    // the sentence nor the two actions under it.
    expect(screen.queryByText(OPEN_WARNING)).toBeNull();
    expect(screen.queryByText("View open ticket")).toBeNull();
    expect(screen.queryByText(/Open another under/)).toBeNull();
    // And the form still belongs to the number the tech is actually typing.
    expect(document.querySelector(".save-bar .summary")!.textContent).toContain("71802");

    // The heart of it: an expired check is NOT permission to save. The click
    // captured 71801, the check never got a verdict that still applies, so
    // writing anything here opens a SECOND ticket under 71801 — the exact
    // thing the check exists to stop.
    expect(createOpenEntryAction).not.toHaveBeenCalled();
    // …and no navigation, because a save that didn't happen must not look like
    // one that did. (performSave treats a bare `return` from onSave as success
    // and pushes the redirect, so this is the assertion that a silent drop
    // would fail.)
    expect(routerPush).not.toHaveBeenCalled();

    // The tech is told, in one honest sentence, why nothing happened.
    expect(screen.getByText(STALE_ABORT).textContent).toMatch(/press Open ticket again/);
  });

  it("retracts the stale-check message on the next RO-number edit", async () => {
    let resolveCheck!: (v: unknown[]) => void;
    findOpenRoAction.mockImplementation(
      () => new Promise<unknown[]>((res) => { resolveCheck = res; }),
    );

    renderOpenTicketForm();
    typeRo("71801");
    await act(async () => {
      clickButton("Open ticket").click();
    });
    typeRo("71802");
    await act(async () => {
      resolveCheck([{ id: "open-1", roNumber: "71801", status: "open", opCodes: [] }]);
    });

    expect(screen.queryByText(STALE_ABORT)).not.toBeNull();

    // "Press Open ticket again" is advice, not a standing accusation — the
    // next keystroke is the tech taking it.
    typeRo("718023");
    expect(screen.queryByText(STALE_ABORT)).toBeNull();
  });

  it("still warns when the number is unchanged while the check runs", async () => {
    let resolveCheck!: (v: unknown[]) => void;
    findOpenRoAction.mockImplementation(
      () => new Promise<unknown[]>((res) => { resolveCheck = res; }),
    );

    renderOpenTicketForm();
    typeRo("71801");

    await act(async () => {
      clickButton("Open ticket").click();
    });

    await act(async () => {
      resolveCheck([{ id: "open-1", roNumber: "71801", status: "open", opCodes: [] }]);
    });

    // The guard must not swallow the ordinary case it was added to narrow.
    expect(screen.getByText(OPEN_WARNING).textContent).toContain("71801");
    expect(screen.queryByText("View open ticket")).not.toBeNull();
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

// ---------------------------------------------------------------------------
// keep-flag-date-restamps-time: "Keep flag date" on a REOPENED close keeps the
// whole flag timestamp — date AND time — not the date with the time re-stamped
// to now. Only visible with trackRoTime on, so every case but the last has it on.

const TODAY = "2026-09-16";
const FLAG_DATE = "2026-09-12";
const NOW = "03:31"; // what the page computed at render — the first-close default
const STORED = "03:28"; // what the first close wrote

function openTicket(): Entry {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    userId: "u",
    createdAt: "2026-09-10T09:00:00Z",
    updatedAt: "2026-09-12T03:28:00Z",
    date: FLAG_DATE,
    loggedTime: STORED,
    roNumber: "4410",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [
      {
        id: "l0",
        opCodeId: null,
        custom: true,
        customCode: "BRK",
        customDescription: "Brakes",
        flagHours: 1.5,
        actualHours: null,
        notes: "",
        position: 0,
        subOpCodeId: null,
        laborType: null,
      },
    ],
    flagHours: 1.5,
    notes: "",
    status: "open",
  } as Entry;
}

function closeDefaults(over: { reopened: boolean; currentTime: string | null }) {
  return {
    today: TODAY,
    currentDate: FLAG_DATE,
    defaultLoggedTime: NOW,
    trackRoTime: true,
    prefill: { actualHours: 0, actualSource: "estimate" },
    ...over,
  };
}

async function renderClose(trackRoTime = true) {
  await act(async () => {
    render(
      <LogRoForm
        initialOpCodes={[]}
        roTemplates={[]}
        existingEntry={openTicket()}
        closeMode
        today={TODAY}
        trackRoTime={trackRoTime}
        defaultLoggedTime={trackRoTime ? NOW : ""}
        timeZone="America/Los_Angeles"
      />,
    );
  });
}

const timePill = () => document.getElementById("ro-time") as HTMLInputElement | null;
const datePill = () => document.getElementById("ro-date") as HTMLInputElement;
const radio = (label: RegExp) =>
  screen.getByLabelText(label, { selector: "input[type=radio]" }) as HTMLInputElement;

describe("LogRoForm — a reopened close keeps the whole flag timestamp", () => {
  it("seeds the stored time, not now, alongside the kept date", async () => {
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: true, currentTime: STORED }),
    );
    await renderClose();

    expect(datePill().value).toBe(FLAG_DATE);
    expect(radio(/Keep flag date/).checked).toBe(true);
    expect(timePill()!.value).toBe(STORED);

    // And the pill is what gets persisted.
    await act(async () => {
      clickButton("Close ticket").click();
    });
    expect(closeTicketAction).toHaveBeenCalledTimes(1);
    expect(closeTicketAction.mock.calls[0][0]).toMatchObject({
      date: FLAG_DATE,
      loggedTime: STORED,
    });
  });

  it("Move to today takes the fresh now time; Keep puts the stored one back", async () => {
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: true, currentTime: STORED }),
    );
    await renderClose();

    act(() => radio(/Move to today/).click());
    expect(datePill().value).toBe(TODAY);
    expect(timePill()!.value).toBe(NOW);

    act(() => radio(/Keep flag date/).click());
    expect(datePill().value).toBe(FLAG_DATE);
    expect(timePill()!.value).toBe(STORED);
  });

  it("leaves the pill empty when the first close recorded no time", async () => {
    // Not now: now on the OLD flag day is a moment that never happened.
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: true, currentTime: null }),
    );
    await renderClose();

    expect(timePill()!.value).toBe("");
    act(() => radio(/Move to today/).click());
    expect(timePill()!.value).toBe(NOW);
    act(() => radio(/Keep flag date/).click());
    expect(timePill()!.value).toBe("");
  });

  it("leaves a FIRST close exactly as it was: today, and the now time", async () => {
    getCloseDefaultsAction.mockResolvedValue(
      // currentTime present on purpose: a first close must ignore it.
      closeDefaults({ reopened: false, currentTime: STORED }),
    );
    await renderClose();

    expect(screen.queryByTestId("reopen-date-choice")).toBeNull();
    expect(datePill().value).toBe(TODAY);
    expect(timePill()!.value).toBe(NOW);
  });

  it("injects no time with the setting off, on either radio", async () => {
    getCloseDefaultsAction.mockResolvedValue({
      ...closeDefaults({ reopened: true, currentTime: STORED }),
      defaultLoggedTime: "",
      trackRoTime: false,
    });
    await renderClose(false);

    expect(timePill()).toBeNull();
    act(() => radio(/Move to today/).click());
    act(() => radio(/Keep flag date/).click());

    await act(async () => {
      clickButton("Close ticket").click();
    });
    expect(closeTicketAction).toHaveBeenCalledTimes(1);
    const sent = closeTicketAction.mock.calls[0][0] as { loggedTime?: string | null };
    expect(sent.loggedTime).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wave 2 of keep-flag-date-restamps-time. Three more ways to save a reopened
// ticket's flag somewhere the tech didn't choose. Every case asserts the SAVED
// payload — the pills are only a description of it.

/** Set a controlled input's value the way a user edit does (React's onChange). */
function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const saveButton = () => screen.getByTestId("ro-save") as HTMLButtonElement;

async function clickClose() {
  await act(async () => {
    saveButton().click();
  });
}

function sentPayload() {
  expect(closeTicketAction).toHaveBeenCalledTimes(1);
  return closeTicketAction.mock.calls[0][0] as {
    date: string;
    loggedTime?: string | null;
    opCodes: { actualHours: number | null }[];
  };
}

/** A promise the test settles by hand: "the fetch is still in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("LogRoForm — typing the date by hand carries the radio's time", () => {
  beforeEach(() => {
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: true, currentTime: STORED }),
    );
  });

  it("Move, then typing the flag date back, restores the stored time and saves it", async () => {
    await renderClose();
    act(() => radio(/Move to today/).click());
    expect(timePill()!.value).toBe(NOW);

    setInput(datePill(), FLAG_DATE);
    expect(radio(/Keep flag date/).checked).toBe(true);
    expect(timePill()!.value).toBe(STORED);

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: FLAG_DATE, loggedTime: STORED });
  });

  it("typing today's date is Move: the now time comes with it", async () => {
    await renderClose();
    setInput(datePill(), TODAY);
    expect(radio(/Move to today/).checked).toBe(true);
    expect(timePill()!.value).toBe(NOW);

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: TODAY, loggedTime: NOW });
  });

  it("a third date leaves the time pill alone, hand-typed time included", async () => {
    await renderClose();
    setInput(timePill()!, "05:00");
    setInput(datePill(), "2026-09-14");
    // Neither radio describes Sep 14, and the time is the tech's.
    expect(radio(/Keep flag date/).checked).toBe(false);
    expect(radio(/Move to today/).checked).toBe(false);
    expect(timePill()!.value).toBe("05:00");

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: "2026-09-14", loggedTime: "05:00" });
  });

  it("custom back to the flag date is a real change of choice: the stored time returns", async () => {
    await renderClose();
    setInput(datePill(), "2026-09-14");
    setInput(timePill()!, "05:00");
    setInput(datePill(), FLAG_DATE);
    expect(timePill()!.value).toBe(STORED);

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: FLAG_DATE, loggedTime: STORED });
  });

  it("a FIRST close is untouched: typing the opened-day date doesn't blank the time", async () => {
    // currentFlagDate is loaded on a first close too (the opened-day
    // placeholder); the radios aren't shown and no stored time was loaded.
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: false, currentTime: STORED }),
    );
    await renderClose();
    // Via a third date first, so the hidden choice really changes to "keep".
    setInput(datePill(), "2026-09-14");
    setInput(datePill(), FLAG_DATE);
    expect(timePill()!.value).toBe(NOW);

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: FLAG_DATE, loggedTime: NOW });
  });
});

describe("LogRoForm — a server re-render doesn't reseed the close", () => {
  it("keeps Move + a hand-typed time when existingEntry arrives as a new, equal object", async () => {
    getCloseDefaultsAction.mockResolvedValue(
      closeDefaults({ reopened: true, currentTime: STORED }),
    );
    const props = {
      initialOpCodes: [],
      roTemplates: [],
      closeMode: true,
      today: TODAY,
      trackRoTime: true,
      timeZone: "America/Los_Angeles",
    };
    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(
        <LogRoForm {...props} existingEntry={openTicket()} defaultLoggedTime={NOW} />,
      ));
    });

    act(() => radio(/Move to today/).click());
    setInput(timePill()!, "06:45");

    // What the /log revalidate after createLibraryOpCode hands the form: the
    // same ticket as a brand-new object, and a fresh now.
    await act(async () => {
      rerender(<LogRoForm {...props} existingEntry={openTicket()} defaultLoggedTime="03:40" />);
    });

    expect(getCloseDefaultsAction).toHaveBeenCalledTimes(1);
    expect(radio(/Move to today/).checked).toBe(true);
    expect(datePill().value).toBe(TODAY);
    expect(timePill()!.value).toBe("06:45");

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: TODAY, loggedTime: "06:45" });
  });
});

describe("LogRoForm — no close until the close defaults have loaded", () => {
  it("holds Close while the fetch is in flight, then saves the reopened defaults", async () => {
    const d = deferred<unknown>();
    getCloseDefaultsAction.mockReturnValue(d.promise);
    await renderClose();

    // The placeholder defaults a reopened ticket must never be saved with.
    expect(datePill().value).toBe(TODAY);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute("aria-busy")).toBe("true");
    expect(saveButton().textContent).toBe("Loading ticket…");
    expect(screen.getByRole("status").textContent).toMatch(/Loading this ticket/);
    await clickClose();
    expect(closeTicketAction).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve(closeDefaults({ reopened: true, currentTime: STORED }));
    });
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().getAttribute("aria-busy")).toBeNull();
    expect(saveButton().textContent).toBe("Close ticket");

    await clickClose();
    expect(sentPayload()).toMatchObject({ date: FLAG_DATE, loggedTime: STORED });
  });

  it("holds a FIRST close too, since 'first' is part of the answer", async () => {
    const d = deferred<unknown>();
    getCloseDefaultsAction.mockReturnValue(d.promise);
    await renderClose();
    expect(saveButton().disabled).toBe(true);
    await clickClose();
    expect(closeTicketAction).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve(closeDefaults({ reopened: false, currentTime: STORED }));
    });
    await clickClose();
    expect(sentPayload()).toMatchObject({ date: TODAY, loggedTime: NOW });
  });

  it("a failed fetch blocks the close with a retry; the retry restores dates AND the prefill", async () => {
    getCloseDefaultsAction
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ...closeDefaults({ reopened: true, currentTime: STORED }),
        prefill: { actualHours: 2.5, actualSource: "timer", excludedHoldHours: 0 },
      });
    await renderClose();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Couldn.t load this ticket.s close details/);
    expect(alert.id).toBe("close-defaults-error");
    // The failed fetch is the one carrying the hours: "no hours were logged"
    // would be a confident lie.
    expect(screen.queryByText(/No hours were logged/)).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute("aria-describedby")).toBe("close-defaults-error");
    await clickClose();
    expect(closeTicketAction).not.toHaveBeenCalled();

    await act(async () => {
      clickButton("Try again").click();
    });

    expect(getCloseDefaultsAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(radio(/Keep flag date/).checked).toBe(true);
    expect(screen.getByText(/Timeline says/).textContent).toMatch(/2\.5h/);

    await clickClose();
    const sent = sentPayload();
    expect(sent).toMatchObject({ date: FLAG_DATE, loggedTime: STORED });
    expect(sent.opCodes[0].actualHours).toBe(2.5);
  });
});
