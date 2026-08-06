// Guards a "use server" footgun that every other check in this repo misses.
//
// Next.js enumerates a "use server" module's exports to build the server-action
// registry and emits a runtime binding for each one. A RE-EXPORTED type has no
// runtime value — it arrived through a type-only import — so the emitted binding
// dangles and the module throws on first render:
//
//     ReferenceError: ImportBundle is not defined
//
// That shipped on 2026-08-05 (`export type { ImportBundle }` in settings.ts) and
// broke every render that loads the module, including saving an RO. tsc, eslint
// and `next build` all passed on it; only requesting a built page failed.
//
// Declaring a type inline is FINE — `export type TimerSaveResult = {...}` and
// friends are erased outright. It is specifically the re-export form that leaves
// a reference behind, so that is all this test bans.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

const SRC = join(process.cwd(), "src");

// `export { X }` / `export type { X }` / `export * from "..."` — every form that
// re-exports a binding rather than declaring one.
const REEXPORT = /^\s*export\s+(?:type\s+)?\{[^}]*\}\s*(?:from\s+['"][^'"]+['"])?\s*;?\s*$/m;
const STAR_REEXPORT = /^\s*export\s+\*\s+from\s+['"][^'"]+['"]\s*;?\s*$/m;

describe('"use server" modules', () => {
  const serverFiles = walk(SRC).filter((f) => {
    const head = readFileSync(f, "utf8").slice(0, 200);
    return /^\s*["']use server["']/.test(head);
  });

  it("finds the server action modules to check", () => {
    // If this drops to zero the test has stopped guarding anything.
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  it.each(serverFiles.map((f) => [f.replace(SRC, "src")] as const))(
    "%s re-exports nothing",
    (relative) => {
      const source = readFileSync(join(SRC, relative.replace(/^src/, "")), "utf8");
      const offenders = source
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => REEXPORT.test(line) || STAR_REEXPORT.test(line));

      expect(
        offenders,
        `${relative} re-exports a binding. Next.js emits a runtime export for it; ` +
          `if it is a type the reference dangles and the module throws on render. ` +
          `Declare the type inline, or move it to a plain module and import from there.\n` +
          offenders.map(([n, l]) => `  line ${n}: ${l.trim()}`).join("\n"),
      ).toEqual([]);
    },
  );
});
