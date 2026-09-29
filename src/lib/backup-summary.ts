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
  | { key: string; label: string; state: "untouched" }
  /**
   * A CORE table the file doesn't carry. Import refuses the whole file (see
   * missingCoreSectionRefusal) — never "untouched", because the RPC wipes core
   * tables unconditionally and that label would promise a keep it can't honor.
   */
  | { key: string; label: string; state: "missing" }
  /**
   * A core table a GENUINE older backup never carried (see
   * CORE_SECTIONS_ABSENT_BY_VERSION). Import proceeds and the RPC empties the
   * table — which is exactly what replacing with a backup from before the
   * feature existed means — so the dialog says "cleared", with the reason.
   */
  | { key: string; label: string; state: "cleared"; detail: string };

export type BackupWarning = { label: string; detail: string };

export type BackupSummary = {
  version: number;
  exportedAt: string | null;
  sections: BackupSection[];
  warnings: BackupWarning[];
  /** Non-null when the file can't be imported at all; the sentence to show. */
  refusal: string | null;
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
 * The tables import_replace_account DELETES UNCONDITIONALLY (no `data ? key`
 * guard), unlike every other section above. For these, "absent" cannot mean
 * "leave mine alone": buildImportPayload would send `[]` and the RPC would wipe
 * the account's rows.
 *
 * So a file missing any of them is refused outright, on both sides: the picker
 * refuses it before the dialog opens, and importDataAction refuses it before
 * anything else runs. An EMPTY array is a real "I have none" and imports.
 *
 * The one exception is CORE_SECTIONS_ABSENT_BY_VERSION below.
 */
export const CORE_SECTION_KEYS = [
  "entries",
  "opCodes",
  "dailyClocks",
  "paidPeriods",
  "bonuses",
] as const satisfies readonly (keyof ImportBundle)[];

const CORE: ReadonlySet<string> = new Set(CORE_SECTION_KEYS);

/**
 * Core sections a GENUINE export of that version may lack, and the dialog's
 * reason. Evidence (git): entries/opCodes/dailyClocks/paidPeriods are in the
 * very first export (e77d6a0, v1). `bonuses` joined the export in 89486ec
 * (2026-07-07) while the version was still 1; v2 (584e450) and every later
 * version always carry it. So a v1 file without bonuses is a real pre-spiff
 * backup — it imports, and the destination's spiffs are cleared. Anywhere else
 * a missing core key means a damaged file and is refused.
 */
const CORE_SECTIONS_ABSENT_BY_VERSION: Record<number, Partial<Record<string, string>>> = {
  1: { bonuses: "this backup predates spiffs" },
};

function allowedAbsenceReason(version: unknown, key: string): string | null {
  if (typeof version !== "number") return null;
  return CORE_SECTIONS_ABSENT_BY_VERSION[version]?.[key] ?? null;
}

function isAbsent(b: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(b, key) || b[key] == null;
}

/**
 * The refusal sentence for a file missing a core section, or null when all five
 * are present. Same absent-test as summarizeBackup (missing key OR null), so the
 * dialog and the server can never disagree about what "missing" means. A
 * present-but-wrong-type value is not this function's business — the schema
 * refuses that with its own sentence.
 */
export function missingCoreSectionRefusal(bundle: unknown): string | null {
  if (!bundle || typeof bundle !== "object") return null;
  const b = bundle as Record<string, unknown>;
  for (const key of CORE_SECTION_KEYS) {
    if (isAbsent(b, key) && !allowedAbsenceReason(b.version, key)) {
      const label = SECTIONS.find((s) => s.key === key)!.label.toLowerCase();
      return `This backup is missing its ${label} section, so nothing was imported — your current data is unchanged.`;
    }
  }
  return null;
}

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
    if (isAbsent(b, key)) {
      if (!CORE.has(key)) return { key, label, state: "untouched" };
      const reason = allowedAbsenceReason(b.version, key);
      return reason
        ? { key, label, state: "cleared", detail: reason }
        : { key, label, state: "missing" };
    }
    const count = countOf(b[key]);
    // A core value that isn't a list is no more usable than an absent one —
    // never "untouched" for a table the RPC wipes regardless.
    if (count === null) return { key, label, state: CORE.has(key) ? "missing" : "untouched" };
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
    refusal: missingCoreSectionRefusal(bundle),
  };
}

/** Manifest reasons are written for developers and run long; the dialog gets the gist. */
function firstSentence(reason: string): string {
  const cut = reason.indexOf(". ");
  return cut === -1 ? reason : reason.slice(0, cut + 1);
}
