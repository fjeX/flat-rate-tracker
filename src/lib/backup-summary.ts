// What the import confirmation screen tells you before it replaces your account.
//
// THE DISTINCTION THIS EXISTS TO MAKE
// "0 work schedules" and "this backup doesn't mention work schedules" look
// identical in a list of counts, and they have OPPOSITE consequences:
//
//   * key present, empty  -> the RPC clears the table. Your schedule is deleted.
//   * key absent          -> the RPC skips the table. Your schedule is kept.
//
// Restoring a v1 or v2 file into a v3 account hits the second case for six
// tables at once, so this is the normal path, not an edge case. Rendering both
// as "0" would tell a user their schedule is about to be wiped when it isn't —
// or, worse, the reverse. The states are named in the type so a caller cannot
// render one as the other by accident.
//
// The warnings come from BACKUP_MANIFEST rather than a second hand-written list:
// a table marked `warnUser` is a table whose absence a user deserves to hear
// about, and that decision already lives in the manifest with its reason.

import { tablesUserShouldBeWarnedAbout, type TableName } from "@/lib/backup-manifest";
import type { ImportBundle } from "@/lib/import-remap";

export type BackupSection =
  /** The file describes this table; import replaces the destination's rows with these. */
  | { key: string; label: string; state: "replacing"; count: number }
  /** The file predates this table. Import leaves what the account already has. */
  | { key: string; label: string; state: "untouched" };

export type BackupWarning = { label: string; detail: string };

export type BackupSummary = {
  version: number;
  exportedAt: string | null;
  sections: BackupSection[];
  warnings: BackupWarning[];
};

/** Order matters — this is reading order in the dialog, biggest stakes first. */
const SECTIONS: { key: keyof ImportBundle; label: string }[] = [
  { key: "entries", label: "Repair orders" },
  { key: "opCodes", label: "Op codes" },
  { key: "dailyClocks", label: "Daily clock records" },
  { key: "paidPeriods", label: "Paid period records" },
  { key: "bonuses", label: "Spiffs & bonuses" },
  { key: "laborRates", label: "Pay rates" },
  { key: "disputes", label: "Disputes" },
  { key: "unpaidTime", label: "Unpaid time" },
  { key: "workSchedules", label: "Work schedules" },
  { key: "daysOff", label: "Days off" },
  { key: "shiftOverrides", label: "Shift overrides" },
  { key: "confirmedZeroDays", label: "Confirmed zero days" },
  { key: "portfolioSnapshots", label: "Portfolio snapshots" },
  { key: "careerMilestones", label: "Career milestones" },
];

/**
 * User-facing copy for the tables the manifest flags with `warnUser`.
 *
 * The detail is written HERE rather than reused from the manifest's `reason`.
 * Those reasons are developer notes explaining a decision to whoever reads the
 * manifest next, and they open by naming the thing — labor_time_observations'
 * starts "True Time contributions.", which rendered as
 * "True Time contributions — True Time contributions." and threw away the
 * actual explanation. One string cannot be both a code comment and product copy.
 *
 * A table with no entry here still appears, falling back to the manifest's
 * reason — clumsy wording beats a warning that silently vanishes.
 */
const WARNING_COPY: Partial<Record<TableName, { label: string; detail: string }>> = {
  entry_photos: {
    label: "RO photos",
    detail: "Image files are never included in a backup — only their metadata.",
  },
  labor_time_observations: {
    label: "True Time contributions",
    detail:
      "They stay with the account that recorded them. Copying them would count the " +
      "same real-world jobs twice and skew the shared times everyone sees.",
  },
};

function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  // shiftOverrides is a date -> shift map, not an array.
  if (value && typeof value === "object") return Object.keys(value).length;
  return null;
}

export function summarizeBackup(bundle: ImportBundle): BackupSummary {
  const b = bundle as unknown as Record<string, unknown>;

  const sections: BackupSection[] = SECTIONS.map(({ key, label }) => {
    // hasOwnProperty, not a truthiness check: an empty array is a real value
    // that means "delete what's there", and `?? 0` would have flattened it into
    // the same "0" an absent key produces.
    if (!Object.prototype.hasOwnProperty.call(b, key) || b[key] == null) {
      return { key, label, state: "untouched" };
    }
    const count = countOf(b[key]);
    if (count === null) return { key, label, state: "untouched" };
    return { key, label, state: "replacing", count };
  });

  const warnings: BackupWarning[] = [];
  for (const { table, reason } of tablesUserShouldBeWarnedAbout()) {
    const copy = WARNING_COPY[table];
    let detail = copy?.detail ?? firstSentence(reason);

    // Photos are the one warning worth quantifying — "3 photos stay behind" is
    // a decision the user can act on, where the others are just facts.
    if (table === "entry_photos") {
      const n = countOf(b.entryPhotos) ?? 0;
      if (n > 0) {
        detail = `${n} photo${n === 1 ? "" : "s"} stay in secure storage — the image files aren't in this backup.`;
      }
    }

    warnings.push({ label: copy?.label ?? table, detail });
  }

  // Not a table, so the manifest has nothing to say about it — but it is the
  // question someone migrating accounts actually asks.
  warnings.push({
    label: "Sign-in identity",
    detail:
      "Your email and Google sign-in belong to the account you're signed in as. A backup can't move them.",
  });

  return {
    version: bundle.version,
    exportedAt: typeof bundle.exportedAt === "string" ? bundle.exportedAt : null,
    sections,
    warnings,
  };
}

/** Manifest reasons are written for developers and run long; the dialog gets the gist. */
function firstSentence(reason: string): string {
  const cut = reason.indexOf(". ");
  return cut === -1 ? reason : reason.slice(0, cut + 1);
}
