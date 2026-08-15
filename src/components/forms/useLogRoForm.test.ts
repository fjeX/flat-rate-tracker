// @vitest-environment jsdom
//
// The first component-level tests in the project. The global vitest environment
// stays "node" — 973 pure-logic tests have no use for a DOM and shouldn't pay
// for one — so hook/component files opt in with the docblock above rather than
// the config switching wholesale.
//
// These exist because of a specific failure: `resetForm` cleared every field on
// the form EXCEPT `loggedTime`, so Save & New carried the previous RO's clock
// time onto the next ticket and wrote it. Nothing could catch that — tsc, lint,
// the unit suite and the visual gate all pass, because the bug is a field
// missing from a list. The reset test below is the shape that does catch it,
// and it's the reason to keep this file growing as fields are added.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLogRoForm } from "./useLogRoForm";
import { hhmmInTz } from "@/lib/periods";
import type { RoMatch } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

// Server-action modules can't be imported into a test process ("use server"),
// and the point here is form state, not the persist.
const saveEntry = vi.fn(async () => ({ id: "entry-1", opCodes: [] }));
const findDuplicateRos = vi.fn(async (): Promise<RoMatch[]> => []);
vi.mock("@/app/actions/entries", () => ({
  saveEntry: (...a: unknown[]) => saveEntry(...(a as [])),
  findDuplicateRos: (...a: unknown[]) => findDuplicateRos(...(a as [])),
  deleteEntryAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
// Retro capture reads a persisted Entry shape we deliberately don't build here.
vi.mock("@/lib/retro-capture", () => ({ retroCandidates: () => [] }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

const TZ = "UTC";

function setup(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useLogRoForm({
      initialOpCodes: [],
      trackRoTime: true,
      timeZone: TZ,
      defaultLoggedTime: "09:15",
      ...overrides,
    }),
  );
}

// A save has to look real enough to reach afterSave: the RO number is what
// gates the duplicate check, and a line is what makes the ticket non-empty.
async function fillAndSaveAndNew(
  result: { current: ReturnType<typeof useLogRoForm> },
  roNumber: string,
) {
  act(() => {
    result.current.setRoNumber(roNumber);
    result.current.addCustomLine({ code: "OIL", description: "LOF", flagHours: 0.5 });
  });
  await act(async () => {
    result.current.handleSaveAndNew();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findDuplicateRos.mockResolvedValue([]);
  saveEntry.mockResolvedValue({ id: "entry-1", opCodes: [] });
  // No localStorage reset here on purpose: this jsdom setup doesn't expose one,
  // and `useStored` already treats "no storage" as "no saved default", which is
  // the state these tests want anyway.
});

describe("resetForm (Save & New)", () => {
  it("re-reads the clock instead of carrying the previous RO's logged time", async () => {
    const { result } = setup();

    // The tech types a time for RO #1 — this is the value that used to survive.
    act(() => result.current.setLoggedTime("07:30"));
    // Control: the assertion below can actually fail. Without this, a hook that
    // never applied the typed value at all would pass the "not 07:30" check
    // vacuously.
    expect(result.current.loggedTime).toBe("07:30");

    const before = hhmmInTz(TZ);
    await fillAndSaveAndNew(result, "55187");
    const after = hhmmInTz(TZ);

    // The regression itself: 07:30 must not ride along to the next RO.
    expect(result.current.loggedTime).not.toBe("07:30");
    // ...and what replaced it is the clock now, not the stale server-rendered
    // `defaultLoggedTime` prop, which is page-load time and only gets older
    // with each Save & New. Two reads bracket a minute rollover.
    expect([before, after]).toContain(result.current.loggedTime);
    expect(result.current.loggedTime).not.toBe("09:15");
  });

  it("clears the logged time entirely when RO time tracking is off", async () => {
    const { result } = setup({ trackRoTime: false, defaultLoggedTime: "" });
    act(() => result.current.setLoggedTime("07:30"));

    await fillAndSaveAndNew(result, "55188");

    // Not a clock read: with the setting off the field isn't shown, and
    // stamping a time onto a form that never asked for one invents data.
    expect(result.current.loggedTime).toBe("");
  });

  it("clears the rest of the RO fields too", async () => {
    const { result } = setup();
    act(() => {
      result.current.setYear("2021");
      result.current.setModel("Camry");
      result.current.setNotes("cust states noise");
    });

    await fillAndSaveAndNew(result, "55189");

    expect(result.current.roNumber).toBe("");
    expect(result.current.year).toBe("");
    expect(result.current.model).toBe("");
    expect(result.current.notes).toBe("");
    expect(result.current.lines).toHaveLength(0);
  });
});

describe("duplicate-RO prompt", () => {
  // The real row behind the escalation: #55102 already existed on the account.
  const match: RoMatch = {
    id: "existing-1",
    date: "2026-07-26",
    vehicleSummary: "2021 Toyota Camry",
  };

  it("defers the write rather than discarding it, and writes nothing on dismiss", async () => {
    findDuplicateRos.mockResolvedValue([match]);
    const { result } = setup();

    act(() => {
      result.current.setRoNumber("55102");
      result.current.addCustomLine({ code: "OIL", description: "LOF", flagHours: 0.5 });
    });
    await act(async () => {
      result.current.handleSave();
    });

    // The escalation was filed as "Save & New silently discards the RO". It
    // doesn't — the persist is gated behind this prompt and simply never ran.
    expect(result.current.dupMatches).toHaveLength(1);
    expect(saveEntry).not.toHaveBeenCalled();
    expect(result.current.abandonedRoNumber).toBeNull();

    // Backing out abandons the save. Nothing is written...
    act(() => result.current.handleDupClose());
    expect(saveEntry).not.toHaveBeenCalled();
    expect(result.current.dupMatches).toBeNull();
    // ...and the screen has to say so, because the only other signal that the
    // RO didn't save is the ABSENCE of the green banner, and the form still
    // holding every line reads as "nothing happened yet".
    expect(result.current.abandonedRoNumber).toBe("55102");
    // The work is still on screen to be saved or corrected.
    expect(result.current.roNumber).toBe("55102");
    expect(result.current.lines).toHaveLength(1);
  });

  it("retires the not-saved notice as soon as the tech tries again", async () => {
    findDuplicateRos.mockResolvedValue([match]);
    const { result } = setup();

    act(() => {
      result.current.setRoNumber("55102");
      result.current.addCustomLine({ code: "OIL", description: "LOF", flagHours: 0.5 });
    });
    await act(async () => {
      result.current.handleSave();
    });
    act(() => result.current.handleDupClose());
    expect(result.current.abandonedRoNumber).toBe("55102");

    // A fresh attempt answers the abandoned one — the notice must not outlive
    // the situation it describes.
    await act(async () => {
      result.current.handleSave();
    });
    expect(result.current.abandonedRoNumber).toBeNull();
  });

  it("still saves when the tech chooses Log as new", async () => {
    findDuplicateRos.mockResolvedValue([match]);
    const { result } = setup();

    act(() => {
      result.current.setRoNumber("55102");
      result.current.addCustomLine({ code: "OIL", description: "LOF", flagHours: 0.5 });
    });
    await act(async () => {
      result.current.handleSave();
    });
    await act(async () => {
      result.current.handleDupLogNew();
    });

    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(result.current.abandonedRoNumber).toBeNull();
  });

  it("saves straight through when the RO number is not a duplicate", async () => {
    findDuplicateRos.mockResolvedValue([]);
    const { result } = setup();

    act(() => {
      result.current.setRoNumber("97014");
      result.current.addCustomLine({ code: "OIL", description: "LOF", flagHours: 0.5 });
    });
    await act(async () => {
      result.current.handleSave();
    });

    expect(result.current.dupMatches).toBeNull();
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(result.current.abandonedRoNumber).toBeNull();
  });
});
