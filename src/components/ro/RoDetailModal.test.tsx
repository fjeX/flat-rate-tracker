// @vitest-environment jsdom
//
// Covers upsell-toggle-aria-row-name: every line's upsell toggle used to
// announce the literal string "Upsell" with no per-row disambiguation
// (RoDetailModal has no row-level aria-labelledby, so every control inside a
// line must self-identify). Proves two lines with different op codes now get
// DISTINCT accessible names — a test with a single line can't catch this,
// since one line's toggle would "pass" even while sharing a name with every
// other line in the RO.
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RoDetailModal } from "./RoDetailModal";
import type { Entry, EntryOpCode } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/entries", () => ({
  addOpCodeLineToEntryAction: vi.fn(),
  deleteEntryAction: vi.fn(),
  deleteEntryLineAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
  setLineUpsellAction: vi.fn(),
}));
vi.mock("@/app/actions/entry-photos", () => ({
  listEntryPhotosAction: vi.fn(async () => []),
  getPhotoSignedUrl: vi.fn(),
  uploadEntryPhoto: vi.fn(),
  deleteEntryPhoto: vi.fn(),
}));
vi.mock("@/app/actions/bonuses", () => ({
  listBonusesForEntryAction: vi.fn(async () => []),
}));

function makeLine(overrides: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "line-1",
    opCodeId: null,
    custom: true,
    customCode: "AB1",
    customDescription: "",
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    isComeback: false,
    isUpsell: false,
    ...overrides,
  } as EntryOpCode;
}

function makeEntry(opCodes: EntryOpCode[]): Entry {
  return {
    id: "entry-1",
    userId: "u1",
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    date: "2026-08-19",
    roNumber: "91630",
    vehicle: { year: "2019", make: "Ford", model: "F-250", vin: "", mileage: "" },
    opCodes,
    flagHours: opCodes.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
  } as Entry;
}

describe("RoDetailModal upsell toggle accessible name", () => {
  it("gives two lines with different op codes distinct accessible names", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "AB1" }),
      makeLine({ id: "line-2", customCode: "CD2" }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    // Each line's toggle must self-identify by op code — not "Upsell" on both.
    // getByRole throws if no element (or more than one) matches the name, so
    // these two calls alone prove the names are distinct.
    expect(screen.getByRole("button", { name: "Mark AB1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark CD2 as upsell" })).toBeTruthy();
  });

  it("names an already-marked upsell as an unmark action, still by code", () => {
    const entry = makeEntry([makeLine({ customCode: "XY9", isUpsell: true })]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Unmark XY9 as upsell" })).toBeTruthy();
  });

  it("falls back to a codeless label when the line has no usable code", () => {
    const entry = makeEntry([makeLine({ customCode: "" })]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Mark as upsell" })).toBeTruthy();
  });
});
