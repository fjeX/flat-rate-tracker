// Binds BACKUP_MANIFEST to the RPC — the last of the four layers, and the only
// one no type can reach.
//
// After backup v3 there were three guards, and a new table tripped every one of
// them: the manifest fails tsc until you rule on it, backup-bundle.test.ts fails
// until the export emits it, and backup-manifest.test.ts fails until the payload
// builder carries its columns.
//
// Then the payload arrives at import_replace_account() — which is SQL, in a
// migration, that nothing type-checks. A table can be declared `carry`, fetched,
// exported, and built into a perfectly correct payload, and the RPC will still
// drop it on the floor without a word, because the RPC only writes the tables it
// names. That is EXACTLY the failure the v3 work existed to remove, and it would
// have come straight back for the next table anyone added.
//
// So this reads the SQL as text. Crude, and deliberately so: the alternative is
// a live Postgres, which `npm test` does not have and should not need.
// supabase/tests/*.test.sql covers behaviour against a real database; this only
// answers "is the table mentioned at all", which is the question that was going
// to be answered wrong.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_MANIFEST, type TableName } from "@/lib/backup-manifest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * The newest migration that (re)defines the RPC. Timestamped filenames sort
 * lexicographically, and each definition is a full CREATE OR REPLACE, so the
 * last one is the live one.
 */
function currentRpcSource(): { file: string; sql: string } {
  const candidates = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();

  for (const file of candidates) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (/CREATE OR REPLACE FUNCTION\s+import_replace_account/i.test(sql)) {
      return { file, sql };
    }
  }
  throw new Error(
    `No migration in ${MIGRATIONS_DIR} defines import_replace_account. ` +
      `If it was renamed, this test needs to learn the new name.`,
  );
}

/**
 * Strip `-- …` comments so a table named only in prose doesn't count as covered.
 *
 * Split on `\r?\n`, not `\n`. On a CRLF checkout every line ended in a stray
 * `\r`, and JS `.` does not match `\r` — so `--.*$` matched nothing, this
 * function returned the SQL untouched, and every guard below silently read
 * comments as code. That fails safe in one direction (is_admin appears in two
 * comments, so the exclusion test screamed) and fails OPEN in the other: a
 * table mentioned only in prose would have satisfied "the RPC writes it".
 * Green on Linux, wrong on Windows, for the same commit.
 */
function withoutComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const { file, sql } = currentRpcSource();
const code = withoutComments(sql);

const carriedTables = (Object.keys(BACKUP_MANIFEST) as TableName[]).filter(
  (t) => BACKUP_MANIFEST[t].carried,
);

describe(`backup manifest ↔ import_replace_account (${file})`, () => {
  it.each(carriedTables)("%s: the RPC writes it", (table) => {
    // Word boundary matters: `entries` must not be satisfied by
    // `INSERT INTO entry_op_codes`, and `disputes` must not be satisfied by
    // `INSERT INTO dispute_lines`.
    const writes = new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, "i").test(code);
    expect(
      writes,
      `${table} is marked \`carried\` in BACKUP_MANIFEST, but ${file} never inserts ` +
        `into it. Export will put this table in the backup file and import will ` +
        `silently ignore it — a backup that looks complete and isn't.`,
    ).toBe(true);
  });

  it.each(carriedTables)("%s: the RPC clears it before restoring", (table) => {
    // A restore that inserts without clearing MERGES into whatever the
    // destination already had, which for a "replace my account" operation shows
    // up as duplicated ROs rather than as an error.
    //
    // Two tables are cleared by FK CASCADE from their parent rather than by a
    // DELETE of their own — the first draft of this test called that a bug, and
    // it wasn't. Naming the parent here keeps the guard honest: it still fails
    // if the parent's delete is ever removed.
    const CASCADES_FROM: Partial<Record<TableName, TableName>> = {
      entry_op_codes: "entries",
      op_code_variants: "op_codes",
    };

    // user_settings is the documented exception: one row per account, updated in
    // place per column so a key the backup omits keeps the destination's value.
    // Deleting it would defeat exactly that.
    if (table === "user_settings") {
      const clears = new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i").test(code);
      expect(clears, "user_settings must be updated in place, never deleted").toBe(false);
      return;
    }

    const parent = CASCADES_FROM[table];
    const target = parent ?? table;
    const clears = new RegExp(`DELETE\\s+FROM\\s+${target}\\b`, "i").test(code);
    expect(
      clears,
      parent
        ? `${table} is cleared by cascade from ${parent}, but ${file} no longer ` +
          `deletes ${parent} — nothing clears ${table} now`
        : `${table} is carried but ${file} never deletes the caller's existing rows, ` +
          `so importing would merge into them instead of replacing them`,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // user_settings, column by column — the hole the table checks left open.
  //
  // Every other carried table is restored with jsonb_populate_recordset, which
  // takes whatever columns the payload has: name the table and its columns come
  // along. user_settings is the one exception. It is UPDATEd column by column on
  // purpose (a missing key must keep the destination's value, which
  // jsonb_populate_record cannot express), so a NEW COLUMN there is restored
  // only if someone writes a line for it.
  //
  // Nothing caught that. The manifest fails tsc until the column is ruled on,
  // and the payload test fails until the builder emits it — so a column could be
  // declared `carry`, exported, and built into a correct payload while this
  // function ignored it. track_ro_time (2026-08-16) is the column that walked
  // through, and it will not be the last one added to this table.
  // ---------------------------------------------------------------------
  const settingsManifest = BACKUP_MANIFEST.user_settings;
  const carriedSettingsColumns = settingsManifest.carried
    ? Object.entries(settingsManifest.columns)
        .filter(([, d]) => d === "carry")
        .map(([c]) => c)
    : [];

  it("has user_settings columns to check", () => {
    // An empty list would make the check below pass vacuously, which is how a
    // guard quietly stops guarding.
    expect(carriedSettingsColumns.length).toBeGreaterThan(5);
  });

  it.each(carriedSettingsColumns)(
    "user_settings.%s: the RPC restores it by name",
    (column) => {
      // Assignment specifically, not a bare mention: `s ? 'goal_hours'` inside
      // some other column's CASE would satisfy a substring search while writing
      // nothing. The SET list is `column = CASE …`.
      const assigns = new RegExp(`\\b${column}\\s*=\\s*CASE\\b`, "i").test(code);
      expect(
        assigns,
        `user_settings.${column} is marked \`carry\` but ${file} never assigns it. ` +
          `Export will put it in the backup file and import will silently ignore ` +
          `it — the setting reverts to the destination account's value with no error.`,
      ).toBe(true);
    },
  );

  it("actually fails when a settings column is missing from the RPC", () => {
    // Pin the matcher against a source where it MUST fire. "All clear" and "the
    // regex matches nothing" look identical from the outside.
    const withColumn = "UPDATE user_settings SET track_ro_time = CASE WHEN s ? 'x' THEN true ELSE track_ro_time END";
    const mentionsOnly = "UPDATE user_settings SET goal_hours = CASE WHEN s ? 'track_ro_time' THEN 1 ELSE goal_hours END";
    const re = (col: string) => new RegExp(`\\b${col}\\s*=\\s*CASE\\b`, "i");
    expect(re("track_ro_time").test(withColumn)).toBe(true);
    expect(re("track_ro_time").test(mentionsOnly)).toBe(false);
  });

  it("never reads an excluded column from the payload", () => {
    // is_admin is the one that matters: a backup is a file the user can edit, so
    // the RPC naming it anywhere outside a comment is a privilege escalation.
    for (const table of carriedTables) {
      const m = BACKUP_MANIFEST[table];
      if (!m.carried) continue;
      for (const [column, disposition] of Object.entries(m.columns)) {
        if (typeof disposition !== "object") continue;
        expect(
          code.includes(column),
          `${table}.${column} is excluded (${disposition.exclude}) but ${file} ` +
            `references it outside a comment`,
        ).toBe(false);
      }
    }
  });

  it("does not carry a table the manifest excludes", () => {
    // active_timers is the deliberate exception — it is CLEARED unconditionally
    // (a running timer points at an RO that is about to stop existing) but never
    // restored, which is why this checks inserts rather than any mention.
    const notCarried = (Object.keys(BACKUP_MANIFEST) as TableName[]).filter(
      (t) => !BACKUP_MANIFEST[t].carried,
    );
    for (const table of notCarried) {
      const writes = new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, "i").test(code);
      expect(
        writes,
        `${table} is marked NOT carried, with reason "${
          (BACKUP_MANIFEST[table] as { reason: string }).reason
        }", but ${file} inserts into it`,
      ).toBe(false);
    }
  });
});
