import { describe, expect, it } from "vitest";
import { summarizeBackup, type BackupSection } from "@/lib/backup-summary";
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
    it("counts the photos that stay behind", () => {
      const s = summarizeBackup(bundle({ entryPhotos: [{}, {}, {}] }));
      const photos = s.warnings.find((w) => w.label === "RO photos");
      expect(photos?.detail).toContain("3 photos");
    });

    it("singularises one photo", () => {
      const s = summarizeBackup(bundle({ entryPhotos: [{}] }));
      expect(s.warnings.find((w) => w.label === "RO photos")?.detail).toContain("1 photo stay");
    });

    it("still explains photos when the backup has none", () => {
      const s = summarizeBackup(bundle());
      const photos = s.warnings.find((w) => w.label === "RO photos");
      expect(photos).toBeDefined();
      expect(photos?.detail).not.toContain("0 photo");
    });

    it("warns that True Time contributions stay with the source account", () => {
      const s = summarizeBackup(bundle());
      expect(s.warnings.some((w) => w.label === "True Time contributions")).toBe(true);
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
