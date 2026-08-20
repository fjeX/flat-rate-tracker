// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";
import { GuestStoreProvider } from "@/lib/guest/context";
import type { Entry } from "@/lib/types";

// Verifies the guest delete-confirm string matches RoDetailModal's approach
// (name the RO, degrade gracefully on missing/garbage fields) without
// asserting on that file — read the actual rendered/confirmed string.

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    userId: "guest",
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    date: "2026-08-19",
    roNumber: "91630",
    vehicle: { year: "2019", make: "Ford", model: "F-250", vin: "", mileage: "" },
    opCodes: [],
    flagHours: 8.5,
    notes: "",
    ...overrides,
  } as Entry;
}

function renderModal(entry: Entry) {
  return render(
    <GuestStoreProvider>
      <GuestRoDetailModal entry={entry} onClose={() => {}} />
    </GuestStoreProvider>,
  );
}

describe("GuestRoDetailModal delete confirm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function captureConfirm(entry: Entry): string {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderModal(entry);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    return confirmSpy.mock.calls[0][0] as string;
  }

  it("names a normal entry", () => {
    const msg = captureConfirm(makeEntry());
    expect(msg).toBe(
      "Delete RO #91630 — 2019 Ford F-250, 8.5h flagged, Aug 19, 2026? This can't be undone.",
    );
  });

  it("degrades when the RO number is blank", () => {
    const msg = captureConfirm(makeEntry({ roNumber: "" }));
    expect(msg).toBe(
      "Delete this RO — 2019 Ford F-250, 8.5h flagged, Aug 19, 2026? This can't be undone.",
    );
  });

  it("drops the vehicle clause when every vehicle field is empty", () => {
    const msg = captureConfirm(
      makeEntry({ vehicle: { year: "", make: "", model: "", vin: "", mileage: "" } }),
    );
    expect(msg).toBe("Delete RO #91630 — 8.5h flagged, Aug 19, 2026? This can't be undone.");
  });

  it("drops hours and date clauses for non-finite hours and a malformed date, falling back to the generic sentence when nothing else identifies it", () => {
    const msg = captureConfirm(
      makeEntry({
        roNumber: "",
        vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
        flagHours: Number.NaN,
        date: "not-a-date",
      }),
    );
    expect(msg).toBe("Delete this RO? This can't be undone.");
  });
});
