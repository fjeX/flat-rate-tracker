// @vitest-environment jsdom
//
// The Download CSV control on History. Pins the wiring, not the file format
// (csv-export.test.ts owns that): the button exists, the exporter is handed the
// same rows the list renders (filters applied, in the list's order), and when
// more ROs exist than the first page the export asks the server for the span
// instead of shipping a short file.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Entry, OpCode, UserSettings } from "@/lib/types";

const loadEntriesInRange = vi.fn();
vi.mock("@/app/actions/entries", () => ({
  loadEntriesInRange: (...a: unknown[]) => loadEntriesInRange(...a),
  loadMoreEntries: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/history",
  useSearchParams: () => new URLSearchParams(),
}));
const buildSpy = vi.fn();
vi.mock("@/lib/csv-export", async (orig) => {
  const real = await orig<typeof import("@/lib/csv-export")>();
  return {
    ...real,
    buildHistoryCsv: (input: Parameters<typeof real.buildHistoryCsv>[0]) => {
      buildSpy(input);
      return real.buildHistoryCsv(input);
    },
  };
});

import { HistoryView } from "./HistoryView";

const created: Blob[] = [];
beforeEach(() => {
  loadEntriesInRange.mockReset();
  buildSpy.mockReset();
  created.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => (created.push(b), "blob:x"));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LIBRARY = [{ id: "oc1", code: "INJ-RR", description: "Injector", subOpCodes: [] }] as unknown as OpCode[];
const SETTINGS = { splitDay: 15, periodOverrides: {} } as unknown as UserSettings;

function ro(id: string, date: string): Entry {
  return {
    id,
    userId: "u",
    createdAt: `${date}T15:00:00Z`,
    updatedAt: `${date}T15:00:00Z`,
    date,
    roNumber: id,
    vehicle: { year: "2019", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    opCodes: [
      {
        id: id + "-l",
        opCodeId: "oc1",
        custom: false,
        customCode: null,
        customDescription: null,
        flagHours: 1,
        actualHours: null,
        notes: "",
        position: 0,
        subOpCodeId: null,
        laborType: null,
      },
    ],
    flagHours: 1,
    notes: "",
  };
}

function view(entries: Entry[], props: Partial<React.ComponentProps<typeof HistoryView>> = {}) {
  return (
    <HistoryView
      entries={entries}
      library={LIBRARY}
      settings={SETTINGS}
      today="2026-03-12"
      periodStart="2026-03-01"
      periodEnd="2026-03-15"
      weekStart="2026-03-08"
      weekEnd="2026-03-14"
      monthStart="2026-03-01"
      monthEnd="2026-03-31"
      weekStartDay={0}
      {...props}
    />
  );
}

const button = () => screen.getByRole("button", { name: /download csv/i });

describe("History CSV export", () => {
  it("shows a Download CSV button", () => {
    render(view([ro("A1", "2026-03-10")]));
    expect(button()).toBeTruthy();
  });

  it("is disabled when nothing matches", () => {
    render(view([]));
    expect((button() as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands the exporter exactly the filtered rows, with the active filters", () => {
    const entries = [ro("A1", "2026-03-10"), ro("B2", "2026-03-11"), ro("OLD", "2026-01-05")];
    render(view(entries, { initial: { range: "period", from: "", to: "", q: "B2", sort: "date", dir: "desc", bar: null } }));
    fireEvent.click(button());
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const input = buildSpy.mock.calls[0][0];
    expect(input.entries.map((e: Entry) => e.id)).toEqual(["B2"]);
    expect(input.filters.q).toBe("B2");
    expect(input.span).toEqual({ start: "2026-03-01", end: "2026-03-15" });
    expect(created).toHaveLength(1);
    expect(loadEntriesInRange).not.toHaveBeenCalled(); // nothing left to page: no fetch
  });

  it("keeps the list's sort order", () => {
    render(view([ro("A1", "2026-03-09"), ro("B2", "2026-03-11")]));
    fireEvent.click(button());
    expect(buildSpy.mock.calls[0][0].entries.map((e: Entry) => e.id)).toEqual(["B2", "A1"]); // newest first
  });

  it("with more pages, fetches the whole span and exports the older ROs too", async () => {
    loadEntriesInRange.mockResolvedValue({
      entries: [ro("A1", "2026-03-10"), ro("EARLY", "2026-03-02")],
    });
    render(view([ro("A1", "2026-03-10")], { hasMore: true }));
    fireEvent.click(button());
    await waitFor(() => expect(buildSpy).toHaveBeenCalledTimes(1));
    expect(loadEntriesInRange).toHaveBeenCalledWith("2026-03-01", "2026-03-15");
    expect(buildSpy.mock.calls[0][0].entries.map((e: Entry) => e.id).sort()).toEqual(["A1", "EARLY"]);
  });

  it("says so and downloads nothing when the full fetch fails", async () => {
    loadEntriesInRange.mockResolvedValue({ error: "nope" });
    render(view([ro("A1", "2026-03-10")], { hasMore: true }));
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
    expect(buildSpy).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
