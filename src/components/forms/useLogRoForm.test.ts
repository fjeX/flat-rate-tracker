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
import type { Entry, RoMatch } from "@/lib/types";

/** What getRoMatchById returns: a RoMatch plus the original's RO number. */
type OriginalMatch = RoMatch & { roNumber: string };

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

// Server-action modules can't be imported into a test process ("use server"),
// and the point here is form state, not the persist.
const saveEntry = vi.fn(async () => ({ id: "entry-1", opCodes: [] }));
const findDuplicateRos = vi.fn(async (): Promise<RoMatch[]> => []);
// Edit-load resolves comebackOfEntryId to its original for the redo-of label.
// A module-level vi.fn like the two above (rather than an inline `async () =>
// null` in the factory) so each test can decide what the lookup finds — or
// WHEN it finds it, which is the only way to reproduce the in-flight race the
// ref guard exists for. Default is null, restored in beforeEach, which is the
// fallback path the pre-existing tests all run through.
const getRoMatchById = vi.fn(
  async (id: string): Promise<OriginalMatch | null> => {
    void id;
    return null;
  },
);
vi.mock("@/app/actions/entries", () => ({
  saveEntry: (...a: unknown[]) => saveEntry(...(a as [])),
  findDuplicateRos: (...a: unknown[]) => findDuplicateRos(...(a as [])),
  deleteEntryAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
  getRoMatchById: (...a: unknown[]) =>
    getRoMatchById(...(a as [id: string])),
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
  // Back to "the lookup finds nothing" — the fallback-label path every test
  // above this line runs through.
  getRoMatchById.mockResolvedValue(null);
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

// The redo-of chip's label on edit-load. A saved comeback carries only
// `comebackOfEntryId` — not the original's RO number, date or vehicle — so the
// hook spends one lookup on mount to turn "Linked to an earlier RO" back into
// "RO #71264 · Aug 21, 2026 · 2015 Subaru Outback". Every test above this line
// mocks that lookup to null, which means until this block existed the suite
// only ever exercised the FALLBACK. Nothing proved the rich label appears at
// all, and nothing proved the two ways it can go wrong stay wrong-proof:
// a late response repainting over the user's own pick, and a failed lookup
// taking the LINK down with the label.
describe("redo-of chip back-fill on edit-load", () => {
  const ORIGINAL_ID = "orig-71264";

  /** The original, as getRoMatchById returns it. */
  const fetched: OriginalMatch = {
    id: ORIGINAL_ID,
    date: "2026-08-21",
    roNumber: "71264",
    vehicleSummary: "2015 Subaru Outback",
  };

  /** A saved comeback RO pointing at ORIGINAL_ID, as edit mode loads it. */
  function comebackEntry(): Entry {
    return {
      id: "entry-comeback",
      userId: "user-1",
      createdAt: "2026-08-22T15:00:00.000Z",
      updatedAt: "2026-08-22T15:00:00.000Z",
      date: "2026-08-22",
      roNumber: "71980",
      vehicle: { year: "2015", make: "Subaru", model: "Outback", vin: "", mileage: "" },
      // A marked line is what makes the entry-level comeback metadata
      // meaningful — performSave nulls comebackOfEntryId out of the payload
      // when no line is a comeback, so without this the payload assertions
      // below would pass for the wrong reason.
      opCodes: [
        {
          id: "line-1",
          opCodeId: null,
          custom: true,
          customCode: "RECHK",
          customDescription: "Recheck noise",
          flagHours: 0,
          actualHours: null,
          notes: "",
          position: 0,
          subOpCodeId: null,
          laborType: null,
          isComeback: true,
        },
      ],
      flagHours: 0,
      notes: "",
      comebackOfEntryId: ORIGINAL_ID,
      comebackKind: "comeback_own",
    };
  }

  /** The comebackOfEntryId that performSave would actually persist. */
  async function savedComebackOfEntryId(
    result: { current: ReturnType<typeof useLogRoForm> },
  ) {
    await act(async () => {
      result.current.handleSave();
    });
    expect(saveEntry).toHaveBeenCalledTimes(1);
    const [input] = saveEntry.mock.calls[0] as unknown as [
      { comebackOfEntryId: string | null },
    ];
    return input.comebackOfEntryId;
  }

  it("seeds the chip with the original's RO number, date and vehicle", async () => {
    getRoMatchById.mockResolvedValue(fetched);
    const { result } = setup({ existingEntry: comebackEntry() });

    // Control: before the lookup resolves the chip has only the bare fallback,
    // so the assertions below can't pass on a value that was there all along.
    expect(result.current.selectedOriginal).toBeNull();

    await act(async () => {});

    expect(getRoMatchById).toHaveBeenCalledWith(ORIGINAL_ID);
    expect(result.current.selectedOriginal).toEqual({
      id: ORIGINAL_ID,
      date: "2026-08-21",
      vehicleSummary: "2015 Subaru Outback",
    });
    // ComebackSection prints "RO #" + this, because RoMatch carries no number.
    expect(result.current.originalRoSearch).toBe("71264");
    // ...and the link itself is untouched. The effect is display-only.
    expect(result.current.comebackOfEntryId).toBe(ORIGINAL_ID);
    expect(await savedComebackOfEntryId(result)).toBe(ORIGINAL_ID);
  });

  it("drops a late response when the tech has already picked a different original", async () => {
    // A lookup this test finishes by hand, so the user's choice lands while it
    // is still in flight — the only window in which the bug is reachable.
    let release: ((match: OriginalMatch) => void) | null = null;
    getRoMatchById.mockImplementation(
      () =>
        new Promise<OriginalMatch | null>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = setup({ existingEntry: comebackEntry() });

    // The tech hits X and picks a different RO before the label comes back.
    const theirPick: RoMatch = {
      id: "orig-99999",
      date: "2026-07-02",
      vehicleSummary: "2019 Honda Civic",
    };
    act(() => result.current.chooseOriginalRo(theirPick));
    expect(result.current.comebackOfEntryId).toBe("orig-99999");

    // NOW the original lookup answers, naming the RO they just abandoned.
    await act(async () => {
      release?.(fetched);
    });

    // Their pick stands. Without the ref check the chip would read
    // "RO #71264 · Aug 21, 2026 · 2015 Subaru Outback" over a
    // comebackOfEntryId of orig-99999 — a label confidently naming the wrong
    // RO on a comeback, which is the one place that has to be exact.
    expect(result.current.selectedOriginal).toEqual(theirPick);
    expect(result.current.comebackOfEntryId).toBe("orig-99999");
    // chooseOriginalRo never touches the search box, so a stale write here is
    // its own tell: "71264" could only have come from the late response.
    expect(result.current.originalRoSearch).toBe("");
    expect(await savedComebackOfEntryId(result)).toBe("orig-99999");
  });

  it("drops a late response when the tech has cleared the link outright", async () => {
    let release: ((match: OriginalMatch) => void) | null = null;
    getRoMatchById.mockImplementation(
      () =>
        new Promise<OriginalMatch | null>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = setup({ existingEntry: comebackEntry() });

    act(() => result.current.clearOriginalRo());
    expect(result.current.comebackOfEntryId).toBeNull();

    await act(async () => {
      release?.(fetched);
    });

    // Unlinking has to stay unlinked. The pre-fix `alive` flag only covered
    // unmount, so this response would have resurrected the chip on a comeback
    // the tech had just told us wasn't a redo of anything.
    expect(result.current.selectedOriginal).toBeNull();
    expect(result.current.originalRoSearch).toBe("");
    expect(result.current.comebackOfEntryId).toBeNull();
    expect(await savedComebackOfEntryId(result)).toBeNull();
  });

  it("keeps the link when the original was deleted and the lookup finds nothing", async () => {
    getRoMatchById.mockResolvedValue(null);
    const { result } = setup({ existingEntry: comebackEntry() });

    await act(async () => {});

    // A dangling link degrades to the bare label and stops there. Turning a
    // missing LABEL into a missing LINK is the 2026-08-12 data-loss bug, where
    // a nulled comebackOfEntryId rode the next save into the column.
    expect(result.current.selectedOriginal).toBeNull();
    expect(result.current.comebackOfEntryId).toBe(ORIGINAL_ID);
    expect(await savedComebackOfEntryId(result)).toBe(ORIGINAL_ID);
  });

  it("keeps the link when the lookup throws", async () => {
    getRoMatchById.mockRejectedValue(new Error("network"));
    const { result } = setup({ existingEntry: comebackEntry() });

    await act(async () => {});

    // Same contract as the null case, via the catch. Silent by design: an
    // error banner over a cosmetic lookup is louder than the problem.
    expect(result.current.selectedOriginal).toBeNull();
    expect(result.current.comebackOfEntryId).toBe(ORIGINAL_ID);
    expect(await savedComebackOfEntryId(result)).toBe(ORIGINAL_ID);
  });

  it("falls back to the bare label rather than render a naked RO number", async () => {
    // Legacy/imported rows can have a blank RO number even though
    // newEntrySchema requires one. The chip is built as "RO #" + the number,
    // so a blank one would render "RO # · Aug 21, 2026 · …".
    getRoMatchById.mockResolvedValue({ ...fetched, roNumber: "   " });
    const { result } = setup({ existingEntry: comebackEntry() });

    await act(async () => {});

    expect(result.current.selectedOriginal).toBeNull();
    expect(result.current.originalRoSearch).toBe("");
    expect(result.current.comebackOfEntryId).toBe(ORIGINAL_ID);
  });

  it("never looks anything up for an RO with no redo-of link", async () => {
    const entry = comebackEntry();
    entry.comebackOfEntryId = null;
    const { result } = setup({ existingEntry: entry });

    await act(async () => {});

    expect(getRoMatchById).not.toHaveBeenCalled();
    expect(result.current.selectedOriginal).toBeNull();
    expect(result.current.comebackOfEntryId).toBeNull();
  });
});

// The same shape of bug as the resetForm one at the top of this file: a field
// missing from a hand-maintained list. `actualSource` was absent from BOTH
// linesFromEntry and the performSave payload, so every edit-save sent
// `undefined` — and db/entries.ts writes
// `actualHours === null ? null : (actualSource ?? null)`, which turns that into
// a NULL actual_source. A retro-captured "estimate" would silently become
// indistinguishable from a timed measurement, and lib/true-time.ts's
// isPoolableLine (the only reader that cares) would let a guess into the shared
// True Time average. Nothing else in the stack can catch it: the type is
// optional, the zod schema is optional, and both are happy with undefined.
describe("actualSource round-trip on edit-save", () => {
  type SavedLine = {
    id?: string;
    actualHours: number | null;
    actualSource?: "timer" | "estimate" | null;
  };

  /** An edit-mode entry with one line carrying whatever source is passed. */
  function entryWithSource(
    actualSource: "timer" | "estimate" | null,
    actualHours: number | null = 1.4,
  ): Entry {
    return {
      id: "entry-est",
      userId: "user-1",
      createdAt: "2026-09-01T15:00:00.000Z",
      updatedAt: "2026-09-01T15:00:00.000Z",
      date: "2026-09-01",
      roNumber: "80231",
      vehicle: { year: "2019", make: "Toyota", model: "Camry", vin: "", mileage: "" },
      opCodes: [
        {
          id: "line-1",
          opCodeId: null,
          custom: true,
          customCode: "OIL",
          customDescription: "LOF",
          flagHours: 0.5,
          actualHours,
          notes: "",
          position: 0,
          subOpCodeId: null,
          laborType: null,
          actualSource,
        },
      ],
      flagHours: 0.5,
      notes: "",
    };
  }

  /** The op-code lines performSave would actually persist. */
  async function savedLines(
    result: { current: ReturnType<typeof useLogRoForm> },
  ): Promise<SavedLine[]> {
    await act(async () => {
      result.current.handleSave();
    });
    expect(saveEntry).toHaveBeenCalledTimes(1);
    const [input] = saveEntry.mock.calls[0] as unknown as [
      { opCodes: SavedLine[] },
    ];
    return input.opCodes;
  }

  it("loads actualSource into the form's line drafts", () => {
    const { result } = setup({ existingEntry: entryWithSource("estimate") });
    expect(result.current.lines[0].actualSource).toBe("estimate");
  });

  it("keeps an estimate an estimate through an ordinary edit-save", async () => {
    const { result } = setup({ existingEntry: entryWithSource("estimate") });
    // Touch an unrelated field — the real-world trigger is a tech fixing a
    // typo, not anything to do with hours.
    act(() => {
      result.current.setNotes("customer waited");
    });
    const [line] = await savedLines(result);
    expect(line.actualSource).toBe("estimate");
    // Guard against passing for the wrong reason: db/entries.ts only reads
    // actualSource when actualHours is non-null.
    expect(line.actualHours).toBe(1.4);
    // The line has to keep its DB id too, or updateEntry treats it as a new
    // row and the assertion above says nothing about the persisted line.
    expect(line.id).toBe("line-1");
  });

  it("keeps a timer measurement labelled as one", async () => {
    const { result } = setup({ existingEntry: entryWithSource("timer") });
    const [line] = await savedLines(result);
    expect(line.actualSource).toBe("timer");
  });

  it("sends an explicit null — never undefined — when there is no source", async () => {
    const { result } = setup({ existingEntry: entryWithSource(null, null) });
    const [line] = await savedLines(result);
    // `undefined` would pass a loose toBe(null)-free check but is exactly the
    // value that made the bug invisible, so assert the property is present.
    expect(line).toHaveProperty("actualSource", null);
  });

  it("leaves a brand-new line with no source at all", async () => {
    const { result } = setup();
    act(() => {
      result.current.setRoNumber("80999");
      result.current.addCustomLine({ code: "TIRE", description: "Rotate", flagHours: 0.3 });
    });
    const [line] = await savedLines(result);
    expect(line.actualSource).toBeNull();
    expect(line.actualHours).toBeNull();
  });
});
