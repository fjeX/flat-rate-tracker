import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEMES } from "./theme";

// THEMES / ACCENTS are copied by hand into SQL twice: the table CHECK
// (20260929000000_appearance.sql) and the import RPC's allow-list
// (20260929000001_import_replace_account_v6.sql). Adding a theme in TS only
// would leave the CHECK refusing every save of it and the RPC silently dropping
// it on restore, with nothing in the build to say so. This test says so.
//
// When a later migration widens the CHECK or redefines the RPC, point these
// paths at it.
const MIGRATIONS = join(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

/**
 * Every `<col> in ('a','b',…)` list in the SQL, case-insensitive. Covers the
 * CHECK's `theme in (` and the RPC's `(s->>'theme') IN (`.
 */
function listsFor(sql: string, col: string): string[][] {
  const re = new RegExp(`${col}'?\\)?\\s+in\\s*\\(([^)]*)\\)`, "gi");
  return [...sql.matchAll(re)].map((m) =>
    [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]),
  );
}

describe.each([
  ["20260929000000_appearance.sql", "table CHECK"],
  ["20260929000001_import_replace_account_v6.sql", "import RPC allow-list"],
])("%s (%s)", (file) => {
  const sql = read(file);

  it("lists exactly THEMES", () => {
    const lists = listsFor(sql, "theme");
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) expect([...l].sort()).toEqual([...THEMES].sort());
  });

  it("lists exactly ACCENTS", () => {
    const lists = listsFor(sql, "accent");
    expect(lists.length).toBeGreaterThan(0);
    for (const l of lists) expect([...l].sort()).toEqual([...ACCENTS].sort());
  });
});
