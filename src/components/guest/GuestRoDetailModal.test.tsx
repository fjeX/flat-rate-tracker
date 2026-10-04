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

describe("GuestRoDetailModal logged / last-edited stamp", () => {
  afterEach(() => sessionStorage.clear());
  const stamp = () => document.querySelector(".rod-logged")?.textContent ?? "";

  it("shows Last edited when the entry was changed after it was logged", () => {
    renderModal(makeEntry({ updatedAt: "2026-08-19T12:30:00.000Z" }));
    expect(stamp()).toMatch(/^Logged .* · Last edited /);
  });

  it("copes with an older stored entry that has no updatedAt", () => {
    renderModal(makeEntry({ updatedAt: undefined as unknown as string }));
    expect(stamp()).toMatch(/^Logged /);
    expect(stamp()).not.toContain("Last edited");
  });
});

// The guest twin reads its pool from the guest store, so seed the real store
// through sessionStorage the way a returning guest session would.
describe("GuestRoDetailModal ranking sentence", () => {
  afterEach(() => sessionStorage.clear());

  const brk = (id: string, actual: number | null) => ({
    id,
    opCodeId: null,
    custom: true,
    customCode: "BRK-F",
    customDescription: "",
    flagHours: 2,
    actualHours: actual,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    isComeback: false,
  });
  const ro = (id: string, actual: number | null): Entry =>
    makeEntry({ id, opCodes: [brk(`l-${id}`, actual)] as unknown as Entry["opCodes"] });

  function seed(entries: Entry[]) {
    sessionStorage.setItem("frt_guest", JSON.stringify({ entries, timers: [], hourlyRate: null }));
  }

  it("ranks a timed line against the guest's other ROs on that code", async () => {
    const mine = ro("mine", 1.2); // 0.6 vs 0.5, 0.7, 1.0 -> 2nd fastest of 4
    seed([mine, ro("a", 1.0), ro("b", 1.4), ro("c", 2.0)]);
    renderModal(mine);
    expect(await screen.findByText("2nd fastest of 4 BRK-F jobs you've timed")).toBeTruthy();
  });

  it("stays quiet with fewer than 3 timed jobs", async () => {
    const mine = ro("mine", 1.2);
    seed([mine, ro("a", 1.0)]);
    renderModal(mine);
    await screen.findByText("BRK-F");
    expect(screen.queryByText(/jobs you've timed/)).toBeNull();
  });
});
