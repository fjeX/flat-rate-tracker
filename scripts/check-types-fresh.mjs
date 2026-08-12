#!/usr/bin/env node
// Fails when the database has a table or column that src/lib/supabase/database.types.ts
// does not know about — i.e. someone applied a migration and skipped
// `npx supabase gen types typescript`.
//
// WHY THIS EXISTS
// src/lib/backup-manifest.ts makes a missed backup column a COMPILE error, but
// it can only do that for columns the generated types describe. Skip the regen
// and the types file still shows yesterday's schema, so the manifest is
// exhaustive over a schema that no longer exists and the guard passes on a lie.
// This closes that hole from the other side, at the moment migrations are
// applied — the one place the real catalog is available.
//
// It deliberately CHECKS rather than regenerates: source changes belong on a dev
// machine and get committed there, never written on the VM.
//
// Usage (from the migrate skill, on the VM):
//   docker exec supabase-db psql -U postgres -d postgres -tAc \
//     "select table_name||'.'||column_name from information_schema.columns \
//      where table_schema='public' order by 1;" \
//     | node scripts/check-types-fresh.mjs
//
// Exit 0 = types match the catalog. Exit 1 = regenerate and commit.

import { readFileSync } from "node:fs";

const TYPES_PATH = "src/lib/supabase/database.types.ts";

// Tables the app never touches through the typed client, so their absence from
// the generated types says nothing about backup coverage.
//
// Keep this list at zero entries wherever possible. Every name here is a hole in
// the guard, so adding one is a decision that needs a reason written next to it —
// the same discipline backup-manifest.ts applies to columns. It is NOT a place to
// silence a table you merely haven't gotten around to.
const NOT_APP_SCHEMA = new Map([
  [
    "applied_migrations",
    "the migrate skill's own ledger — infrastructure it creates and reads via " +
      "raw psql, never through supabase-js, and never part of a backup",
  ],
]);

/** table -> Set(columns), read out of the generated file's Row blocks. */
function parseGeneratedTypes(source) {
  const start = source.indexOf("Tables: {", source.indexOf("public: {"));
  if (start === -1) throw new Error(`Could not find the public Tables block in ${TYPES_PATH}`);
  const body = source.slice(start);
  const tableRe = /\n {6}([a-z_][a-z0-9_]*): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
  const out = new Map();
  let m;
  while ((m = tableRe.exec(body))) {
    const cols = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(":")[0].trim())
      .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
    out.set(m[1], new Set(cols));
  }
  return out;
}

const stdin = readFileSync(0, "utf8");
const catalog = new Map();
for (const raw of stdin.split("\n")) {
  const line = raw.trim();
  if (!line) continue;
  const dot = line.indexOf(".");
  if (dot === -1) continue;
  const table = line.slice(0, dot);
  const column = line.slice(dot + 1);
  if (!catalog.has(table)) catalog.set(table, new Set());
  catalog.get(table).add(column);
}

if (catalog.size === 0) {
  console.error("No catalog rows on stdin — did the psql query run? Refusing to pass vacuously.");
  process.exit(1);
}

const generated = parseGeneratedTypes(readFileSync(TYPES_PATH, "utf8"));

const missingTables = [];
const missingColumns = [];
for (const [table, columns] of catalog) {
  if (NOT_APP_SCHEMA.has(table)) continue;
  const known = generated.get(table);
  if (!known) {
    missingTables.push(table);
    continue;
  }
  for (const c of columns) if (!known.has(c)) missingColumns.push(`${table}.${c}`);
}

// Only one direction is an error. A table the types know about but the database
// lacks means the types are AHEAD — normal on a machine whose migrations have
// not been applied yet, and not this script's problem.
if (missingTables.length === 0 && missingColumns.length === 0) {
  console.log(`types fresh — ${catalog.size} tables, all columns present in ${TYPES_PATH}`);
  process.exit(0);
}

console.error(`\n${TYPES_PATH} is STALE — the database has schema it does not describe.\n`);
if (missingTables.length) console.error(`  Missing tables:  ${missingTables.join(", ")}`);
if (missingColumns.length) console.error(`  Missing columns: ${missingColumns.join(", ")}`);
console.error(
  `
Why this is blocking: backup/import coverage is enforced by a mapped type over
these generated types (src/lib/backup-manifest.ts). While the file is stale that
check is exhaustive over the OLD schema, so a new column can be silently dropped
from every backup and still compile.

Fix on a dev machine, not here:
  npx supabase gen types typescript --db-url <db-url> > ${TYPES_PATH}
then resolve the resulting backup-manifest.ts compile errors and commit both.
`,
);
process.exit(1);
