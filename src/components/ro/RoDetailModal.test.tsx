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
import { toJobTimings } from "@/lib/rankings";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/entries", () => ({
  // Both now RETURN their refusal as { error } (server-action-thrown-
  // refusals-masked); {} is success.
  addOpCodeLineToEntryAction: vi.fn(async () => ({})),
  deleteEntryAction: vi.fn(),
  deleteEntryLineAction: vi.fn(),
  setLineActualHoursAction: vi.fn(),
  setLineUpsellAction: vi.fn(async () => ({})),
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

// The op code is NOT a per-line identifier — a tech logging two alignments on
// one ticket is ordinary, not an edge case — so naming a control after the code
// alone leaves two byte-identical names. Every test here uses the SAME code in
// the SAME state on both lines; a test using two different codes passes against
// the broken version and proves nothing.
describe("RoDetailModal names for lines sharing one op code", () => {
  function names(role: string) {
    return screen
      .getAllByRole(role)
      .map((el) => el.getAttribute("aria-label"))
      .filter((n): n is string => Boolean(n));
  }

  it("gives two same-code lines in the same upsell state distinct toggle names", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "ALIGN" }),
      makeLine({ id: "line-2", customCode: "ALIGN" }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    const upsellNames = names("button").filter((n) => n.endsWith("as upsell"));
    expect(upsellNames).toHaveLength(2);
    expect(new Set(upsellNames).size).toBe(2);
    // getByRole throws on more than one match, so these prove uniqueness too.
    expect(screen.getByRole("button", { name: "Mark ALIGN on line 1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark ALIGN on line 2 as upsell" })).toBeTruthy();
  });

  it("distinguishes same-code lines that are both already marked as upsells", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "ALIGN", isUpsell: true }),
      makeLine({ id: "line-2", customCode: "ALIGN", isUpsell: true }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Unmark ALIGN on line 1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unmark ALIGN on line 2 as upsell" })).toBeTruthy();
  });

  it("gives the Remove buttons of two same-code lines distinct names", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "ALIGN" }),
      makeLine({ id: "line-2", customCode: "ALIGN" }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    const removeNames = names("button").filter((n) => n.startsWith("Remove "));
    expect(removeNames).toHaveLength(2);
    expect(new Set(removeNames).size).toBe(2);
    expect(screen.getByRole("button", { name: "Remove line 1, ALIGN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove line 2, ALIGN" })).toBeTruthy();
  });

  it("distinguishes the actual-hours inputs of two same-code lines", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "ALIGN" }),
      makeLine({ id: "line-2", customCode: "ALIGN" }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    expect(screen.getByRole("spinbutton", { name: "Actual hours for ALIGN on line 1" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Actual hours for ALIGN on line 2" })).toBeTruthy();
  });

  // The fallback branch has the same problem: two lines with no usable code
  // both rendered "Mark as upsell" / "Remove line".
  it("distinguishes two lines that both have no usable code", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "" }),
      makeLine({ id: "line-2", customCode: "   " }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Mark line 1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark line 2 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove line 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove line 2" })).toBeTruthy();
    // The bare em dash is a placeholder, not a name — it must never be spoken.
    expect(names("button").some((n) => n.includes("—"))).toBe(false);
    expect(names("spinbutton").some((n) => n.includes("—"))).toBe(false);
  });

  // Duplicates come from the library path too, not just custom lines.
  it("distinguishes two library lines pointing at the same op code", () => {
    const oc = {
      id: "oc-1",
      code: "ALIGN",
      description: "",
      flagHours: 1,
      subOpCodes: [],
    } as unknown as OpCode;
    const entry = makeEntry([
      makeLine({ id: "line-1", custom: false, customCode: null, opCodeId: "oc-1" }),
      makeLine({ id: "line-2", custom: false, customCode: null, opCodeId: "oc-1" }),
    ]);
    render(<RoDetailModal entry={entry} library={[oc]} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Mark ALIGN on line 1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark ALIGN on line 2 as upsell" })).toBeTruthy();
  });

  // The position is only a tiebreaker — it must not appear when the codes on
  // the RO already tell the lines apart, or every single-line RO in the app
  // grows a pointless "line 1".
  it("does not number lines whose codes are already unique", () => {
    const entry = makeEntry([
      makeLine({ id: "line-1", customCode: "AB1" }),
      makeLine({ id: "line-2", customCode: "CD2" }),
    ]);
    render(<RoDetailModal entry={entry} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Mark AB1 as upsell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove line CD2" })).toBeTruthy();
    expect(names("button").some((n) => /on line \d/.test(n))).toBe(false);
  });
});

// Zone-independent on purpose: the exact strings are pinned in ro-stamps.test.ts
// with an explicit zone; here we only prove the modal wires both timestamps in.
describe("RoDetailModal logged / last-edited stamp", () => {
  function stamp() {
    return document.querySelector(".rod-logged")?.textContent ?? "";
  }

  it("shows only Logged when the row was never touched after saving", () => {
    render(<RoDetailModal entry={makeEntry([makeLine()])} onClose={() => {}} />);
    expect(stamp()).toMatch(/^Logged \w{3} \d{1,2}, /);
    expect(stamp()).not.toContain("Last edited");
  });

  it("adds Last edited when updatedAt is well after createdAt", () => {
    const entry = { ...makeEntry([makeLine()]), updatedAt: "2026-08-19T12:30:00.000Z" };
    render(<RoDetailModal entry={entry} onClose={() => {}} />);
    expect(stamp()).toContain(" · Last edited ");
  });
});

// Ranking sentences ("3rd fastest of 9 BRK-F jobs you've timed"). These render
// the real modal with the same JobTiming pool the dashboard builds, so a
// disconnected prop shows up here as a missing sentence.
describe("RoDetailModal ranking sentence", () => {
  const brk = (id: string, flag: number, actual: number | null) =>
    makeLine({ id, customCode: "BRK-F", flagHours: flag, actualHours: actual });
  const past = (n: number, actual: number): Entry => ({
    ...makeEntry([brk(`p${n}`, 2, actual)]),
    id: `past-${n}`,
  });

  it("shows where a timed line sits among the other jobs on that code", () => {
    const pool = toJobTimings([past(1, 1.0), past(2, 1.4), past(3, 2.0), past(4, 3.0)]);
    // This RO: 1.2h on a 2.0h flag = 0.6; others 0.5, 0.7, 1.0, 1.5 -> 2nd fastest of 5
    render(
      <RoDetailModal entry={makeEntry([brk("mine", 2, 1.2)])} jobTimings={pool} onClose={() => {}} />,
    );
    expect(screen.getByText("2nd fastest of 5 BRK-F jobs you've timed")).toBeTruthy();
  });

  it("carries the pool's scope", () => {
    const pool = toJobTimings([past(1, 1.0), past(2, 1.4), past(3, 2.0)]);
    render(
      <RoDetailModal
        entry={makeEntry([brk("mine", 2, 1.2)])}
        jobTimings={pool}
        jobTimingsScope="in the last 90 days"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/of 4 BRK-F jobs you've timed in the last 90 days/)).toBeTruthy();
  });

  it("says nothing with fewer than 3 timed jobs on the code", () => {
    const pool = toJobTimings([past(1, 1.0)]);
    render(
      <RoDetailModal entry={makeEntry([brk("mine", 2, 1.2)])} jobTimings={pool} onClose={() => {}} />,
    );
    expect(screen.queryByText(/jobs you've timed/)).toBeNull();
  });

  it("says nothing on an untimed line, or when no pool is passed", () => {
    const pool = toJobTimings([past(1, 1.0), past(2, 1.4), past(3, 2.0)]);
    const { unmount } = render(
      <RoDetailModal entry={makeEntry([brk("mine", 2, null)])} jobTimings={pool} onClose={() => {}} />,
    );
    expect(screen.queryByText(/jobs you've timed/)).toBeNull();
    unmount();
    render(<RoDetailModal entry={makeEntry([brk("mine", 2, 1.2)])} onClose={() => {}} />);
    expect(screen.queryByText(/jobs you've timed/)).toBeNull();
  });
});
