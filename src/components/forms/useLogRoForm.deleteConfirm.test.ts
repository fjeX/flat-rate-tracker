// @vitest-environment jsdom
//
// Verifies handleDeleteRo's confirm string mirrors RoDetailModal's
// handleDelete (see that file's handleDelete for the reference behavior):
// name the RO — number, vehicle, flagged hours, date — and degrade to the
// plain generic sentence when every identifying field is missing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLogRoForm } from "./useLogRoForm";
import type { Entry } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions/entries", () => ({
  saveEntry: vi.fn(),
  findDuplicateRos: vi.fn(async () => []),
  deleteEntryAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
}));
vi.mock("@/app/actions/op-codes", () => ({ createLibraryOpCode: vi.fn() }));
vi.mock("@/app/actions/entry-photos", () => ({ uploadEntryPhoto: vi.fn() }));
vi.mock("@/lib/retro-capture", () => ({ retroCandidates: () => [] }));
vi.mock("@/lib/haptics", () => ({ tap: vi.fn() }));

function baseEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry-1",
    userId: "user-1",
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    date: "2026-08-19",
    loggedTime: null,
    roNumber: "91630",
    vehicle: { year: "2019", make: "Ford", model: "F-250", vin: "", mileage: "" },
    opCodes: [],
    flagHours: 8.5,
    notes: "",
    ...overrides,
  };
}

function setup(existingEntry: Entry) {
  return renderHook(() =>
    useLogRoForm({
      initialOpCodes: [],
      existingEntry,
      trackRoTime: true,
      timeZone: "UTC",
      defaultLoggedTime: "09:15",
    }),
  );
}

let captured: string | undefined;

beforeEach(() => {
  captured = undefined;
  vi.spyOn(window, "confirm").mockImplementation((msg?: string) => {
    captured = msg;
    return false; // never actually proceed to delete
  });
});

describe("handleDeleteRo confirm string", () => {
  it("names RO number, vehicle, flagged hours, and date for a normal entry", () => {
    const { result } = setup(baseEntry());
    result.current.handleDeleteRo();
    expect(captured).toBe(
      "Delete RO #91630 — 2019 Ford F-250, 8.5h flagged, Aug 19, 2026? This can't be undone.",
    );
  });

  it("drops the RO number clause when it's blank", () => {
    const { result } = setup(baseEntry({ roNumber: "  " }));
    result.current.handleDeleteRo();
    expect(captured).toBe(
      "Delete this RO — 2019 Ford F-250, 8.5h flagged, Aug 19, 2026? This can't be undone.",
    );
  });

  it("drops the vehicle clause when every vehicle field is empty", () => {
    const { result } = setup(
      baseEntry({ vehicle: { year: "", make: "", model: "", vin: "", mileage: "" } }),
    );
    result.current.handleDeleteRo();
    expect(captured).toBe(
      "Delete RO #91630 — 8.5h flagged, Aug 19, 2026? This can't be undone.",
    );
  });

  it("degrades to the plain generic sentence when every identifying field is missing", () => {
    const { result } = setup(
      baseEntry({
        roNumber: "",
        vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
        flagHours: NaN,
        date: "not-a-date",
      }),
    );
    result.current.handleDeleteRo();
    expect(captured).toBe("Delete this RO? This can't be undone.");
  });
});
