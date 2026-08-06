import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Vitest's default `include` catches **/*.spec.ts, which sweeps up the
    // Playwright specs under tests/e2e. Those call Playwright's `test.describe`,
    // which throws outside a Playwright runner — so `npm test` exited 1 with
    // "2 failed test files" even though every unit test passed. A red exit code
    // that doesn't mean anything is worse than none: it trains everyone to
    // ignore the result, and it silently breaks any CI or /goal check phrased
    // as "npm test exits 0".
    //
    // Spread configDefaults.exclude rather than replacing it — assigning a bare
    // array drops vitest's built-in node_modules/dist exclusions, and it starts
    // collecting tests out of dependencies.
    // tests/smoke/** is excluded for the same reason. Its files are named
    // *.smoke.ts so they don't match vitest's include today, but that's a
    // filename convention holding the line — one file named *.spec.ts in there
    // would reintroduce the exact breakage above.
    exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/smoke/**"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
