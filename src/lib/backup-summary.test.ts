import { describe, expect, it } from "vitest";
import {
  missingCoreSectionRefusal,
  summarizeBackup,
  type BackupSection,
} from "@/lib/backup-summary";
import type { ImportBundle } from "@/lib/import-remap";

function bundle(over: Record<string, unknown> = {}): ImportBundle {
  return {
    version: 3,
    exportedAt: "2026-08-12T00:00:00Z",
    settings: { splitDay: 15, periodOverrides: {} },
    entries: [],
    opCodes: [],
    dailyClocks: [],
    paidPeriods: [],
    bonuses: [],
    ...over,
  } as unknown as ImportBundle;
}

function section(s: ReturnType<typeof summarizeBackup>, key: string): BackupSection {
  const found = s.sections.find((x) => x.key === key);
  if (!found) throw new Error(`no section ${key}`);
  return found;
}

describe("summarizeBackup", () => {
  describe("empty and absent are different states", () => {
    it("an absent key reads as untouched, not as zero", () => {
      // A v2 file has no workSchedules key. The RPC skips the table, so the
      // destination keeps its schedule — telling the user "0 work schedules"
      // would describe a wipe that isn't going to happen.
      const s = summarizeBackup(bundle());
      expect(section(s, "workSchedules")).toEqual({
        key: "workSchedules",
        label: "Work schedules",
        state: "untouched",
      });
    });

    it("an EMPTY array reads as replacing-with-zero, because it clears the table", () => {
      // The user deleted all their days off and backed that up. Restoring must
      // clear the destination's, and the dialog has to say so.
      const s = summarizeBackup(bundle({ daysOff: [] }));
      expect(section(s, "daysOff")).toEqual({
        key: "daysOff",
        label: "Days off",
        state: "replacing",
        count: 0,
      });
    });

    it("an explicit null reads as untouched", () => {
      const s = summarizeBackup(bundle({ disputes: null }));
      expect(section(s, "disputes").state).toBe("untouched");
    });

    it("counts a date-keyed map, not just arrays", () => {
      // shiftOverrides is a date -> shift object; Array.isArray would have
      // reported it as uncountable and silently downgraded it to "untouched".
      const s = summarizeBackup(
        bundle({ shiftOverrides: { "2026-01-05": {}, "2026-01-06": {} } }),
      );
      expect(section(s, "shiftOverrides")).toMatchObject({ state: "replacing", count: 2 });
    });
  });

  it("covers every v3 table, so nothing is replaced without being listed", () => {
    const s = summarizeBackup(bundle());
    for (const key of [
      "entries", "opCodes", "dailyClocks", "paidPeriods", "bonuses", "laborRates",
      "disputes", "unpaidTime", "workSchedules", "daysOff", "shiftOverrides",
      "confirmedZeroDays", "portfolioSnapshots", "careerMilestones",
    ]) {
      expect(s.sections.some((x) => x.key === key), `${key} missing from the dialog`).toBe(true);
    }
  });

  describe("warnings", () => {
    // import-dialog-photos-truetime: the RPC's DELETE FROM entries cascades
    // entry_photos and labor_time_observations, and importDataAction purges the
    // photo files after it commits. They used to sit here saying they "stay".
    it("never lists photos or True Time as staying behind", () => {
      for (const b of [bundle(), bundle({ entryPhotos: [{}, {}, {}] })]) {
        const w = summarizeBackup(b).warnings;
        expect(w.some((x) => /photo/i.test(x.label + x.detail))).toBe(false);
        expect(w.some((x) => /true time/i.test(x.label + x.detail))).toBe(false);
        expect(w.some((x) => /stay in secure storage|stay with the account/.test(x.detail))).toBe(false);
      }
    });

    it("never restates the label as the explanation", () => {
      // Found on prod 2026-08-12: the detail was derived from the manifest's
      // developer-facing `reason`, and labor_time_observations' reason opens by
      // naming itself — so the dialog read "True Time contributions — True Time
      // contributions." and dropped the actual explanation. Guarding the class,
      // not the one string, because the next warnUser table would repeat it.
      for (const w of summarizeBackup(bundle()).warnings) {
        const norm = (s: string) => s.toLowerCase().replace(/[.\s]+$/, "").trim();
        expect(norm(w.detail), `"${w.label}" explains itself with its own name`).not.toBe(
          norm(w.label),
        );
        expect(w.detail.length, `"${w.label}" has no real explanation`).toBeGreaterThan(
          w.label.length,
        );
      }
    });

    it("says identity cannot cross accounts at all", () => {
      // The question someone migrating actually asks, and the one no table
      // in the manifest answers.
      const s = summarizeBackup(bundle());
      const id = s.warnings.find((w) => w.label === "Sign-in identity");
      expect(id?.detail).toMatch(/email|Google/i);
    });
  });

  it("passes through the version and export date for the header", () => {
    const s = summarizeBackup(bundle({ version: 2, exportedAt: "2026-08-01T12:00:00Z" }));
    expect(s.version).toBe(2);
    expect(s.exportedAt).toBe("2026-08-01T12:00:00Z");
  });

  it("reports a missing exportedAt as null rather than the string 'undefined'", () => {
    const s = summarizeBackup(bundle({ exportedAt: undefined }));
    expect(s.exportedAt).toBeNull();
  });
});

// The RPC wipes these five whatever the file says, so "untouched" would be a lie.
describe("core sections", () => {
  const CORE: [string, string][] = [
    ["entries", "repair orders"],
    ["opCodes", "op codes"],
    ["dailyClocks", "daily clock records"],
    ["paidPeriods", "paid period records"],
    ["bonuses", "spiffs & bonuses"],
  ];

  it.each(CORE)("an absent %s is missing + refused, never untouched", (key, label) => {
    const b = bundle() as unknown as Record<string, unknown>;
    delete b[key];
    const s = summarizeBackup(b as unknown as ImportBundle);
    expect(section(s, key).state).toBe("missing");
    expect(s.refusal).toBe(
      `This backup is missing its ${label} section, so nothing was imported — your current data is unchanged.`,
    );
  });

  it.each(CORE)("a null %s is refused too", (key) => {
    expect(missingCoreSectionRefusal(bundle({ [key]: null }))).toMatch(/is missing its/);
  });

  it("empty core arrays are a real 'none' — replacing with zero, no refusal", () => {
    const s = summarizeBackup(bundle());
    expect(s.refusal).toBeNull();
    for (const [key] of CORE) expect(section(s, key)).toMatchObject({ state: "replacing", count: 0 });
  });

  it("absent OPTIONAL keys stay untouched and don't refuse", () => {
    const s = summarizeBackup(bundle());
    expect(s.refusal).toBeNull();
    expect(section(s, "disputes").state).toBe("untouched");
    expect(section(s, "careerMilestones").state).toBe("untouched");
  });
});

describe("v1 predates spiffs", () => {
  it("a v1 file without bonuses is 'cleared' with the reason, not refused/untouched/missing", () => {
    const b = bundle({ version: 1 }) as unknown as Record<string, unknown>;
    delete b.bonuses;
    const s = summarizeBackup(b as unknown as ImportBundle);
    expect(s.refusal).toBeNull();
    expect(section(s, "bonuses")).toEqual({
      key: "bonuses",
      label: "Spiffs & bonuses",
      state: "cleared",
      detail: "this backup predates spiffs",
    });
  });

  it("v2 without bonuses is still missing + refused", () => {
    const b = bundle({ version: 2 }) as unknown as Record<string, unknown>;
    delete b.bonuses;
    const s = summarizeBackup(b as unknown as ImportBundle);
    expect(section(s, "bonuses").state).toBe("missing");
    expect(s.refusal).toMatch(/spiffs & bonuses section/);
  });

  it("v1 without dailyClocks is still refused — only bonuses has an exception", () => {
    const b = bundle({ version: 1 }) as unknown as Record<string, unknown>;
    delete b.dailyClocks;
    expect(missingCoreSectionRefusal(b)).toMatch(/daily clock records section/);
  });
});

// import-dialog-undisclosed-deletes: import_replace_account (v6) deletes
// ro_events and active_timers whatever the file says, and nulls unpaid_time's
// RO links whenever entries are replaced. The dialog said none of it.
describe("what the import does beyond the listed sections", () => {
  it("ticket timelines carried by the file: replacing N", () => {
    const s = summarizeBackup(bundle({ version: 5, roEvents: [{}, {}, {}] }));
    expect(section(s, "roEvents")).toEqual({
      key: "roEvents",
      label: "Ticket timelines",
      state: "replacing",
      count: 3,
    });
  });

  it("ticket timelines carried but empty: replacing 0 (the dialog's red 'cleared')", () => {
    const s = summarizeBackup(bundle({ version: 5, roEvents: [] }));
    expect(section(s, "roEvents")).toMatchObject({ state: "replacing", count: 0 });
  });

  it.each([1, 2, 3, 4, 5])(
    "a v%i file without ticket timelines says they are cleared — never 'kept'",
    (version) => {
      const s = summarizeBackup(bundle({ version }));
      expect(section(s, "roEvents")).toEqual({
        key: "roEvents",
        label: "Ticket timelines",
        state: "cleared",
        detail: "this backup has no ticket timelines",
      });
      // Not a file refusal: an old backup genuinely can't carry them, and
      // the server refuses only when the account has some to lose.
      expect(s.refusal).toBeNull();
    },
  );

  it("a non-list roEvents is still never 'kept'", () => {
    const s = summarizeBackup(bundle({ version: 5, roEvents: "abc" }));
    expect(section(s, "roEvents").state).toBe("cleared");
  });

  it("running timers, RO photos and True Time — all said on every import", () => {
    for (const b of [
      bundle(),
      bundle({ version: 1 }),
      bundle({ version: 5, roEvents: [] }),
      bundle({ version: 5, entryPhotos: [{}, {}] }),
    ]) {
      expect(summarizeBackup(b).sideEffects).toEqual([
        {
          label: "Running timers stop",
          detail:
            "any timer running now is cleared, and time on it that hasn't been saved is lost.",
        },
        {
          label: "Your RO photos are deleted",
          detail: "image files included. Photos aren't in a backup, so none come back.",
        },
        {
          label: "Your True Time contributions are deleted",
          detail: "they go with the repair orders they were measured on.",
        },
      ]);
    }
  });

  it("disputes kept from a file without them say their RO links are cleared", () => {
    for (const b of [bundle(), bundle({ disputes: null }), bundle({ version: 1 })]) {
      expect(section(summarizeBackup(b), "disputes")).toEqual({
        key: "disputes",
        label: "Disputes",
        state: "untouched",
        detail:
          "kept, but their links to repair orders are cleared because the repair orders are replaced — each claim keeps its RO number",
      });
    }
  });

  it("disputes carried by the file are a plain replace, no caveat", () => {
    const s = summarizeBackup(bundle({ disputes: [{}] }));
    expect(section(s, "disputes")).toEqual({
      key: "disputes",
      label: "Disputes",
      state: "replacing",
      count: 1,
    });
  });

  it("unpaid time kept from an older file says its RO links are cleared", () => {
    const s = summarizeBackup(bundle({ version: 1 }));
    expect(section(s, "unpaidTime")).toEqual({
      key: "unpaidTime",
      label: "Unpaid time",
      state: "untouched",
      detail:
        "kept, but its links to repair orders are cleared because the repair orders are replaced — open-work hours lose their ticket",
    });
  });

  it("unpaid time carried by the file is a plain replace, no caveat", () => {
    const s = summarizeBackup(bundle({ unpaidTime: [{}, {}] }));
    expect(section(s, "unpaidTime")).toEqual({
      key: "unpaidTime",
      label: "Unpaid time",
      state: "replacing",
      count: 2,
    });
  });

  it("other untouched sections carry no caveat", () => {
    const s = summarizeBackup(bundle());
    for (const key of ["laborRates", "workSchedules", "daysOff", "careerMilestones"]) {
      expect(section(s, key)).not.toHaveProperty("detail");
    }
  });
});
