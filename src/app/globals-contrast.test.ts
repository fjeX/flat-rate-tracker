import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEMES, type Accent, type Theme } from "@/lib/theme";

/**
 * The permanent contrast gate for the 2026-09 visual overhaul.
 *
 * Parses the token block at the top of globals.css the same way the browser
 * cascades it (source order, only `:root[…]` selectors) and checks every
 * theme × accent pair — 4 × 5 = 20 combinations nobody will ever look at one
 * by one — against WCAG AA. Ported from the scratchpad contrast.mjs that
 * verified final.html; the accent pairs are the ones FINAL-BRIEF.md requires.
 *
 * If this fails after a token edit, the edit is wrong, not the test. Change a
 * minimum here only with a design decision logged next to it.
 */

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const END = "end of token block";

type Ctx = { theme: Theme; accent: Accent };
type Rule = { selectors: string[]; decls: Record<string, string> };

function parseTokenBlock(): Rule[] {
  const end = css.indexOf(END);
  if (end < 0) throw new Error(`globals.css has no "${END}" marker`);
  const block = css.slice(0, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    // drop anything before the selector itself (the @import line, a stray `;`)
    const prelude = m[1].slice(m[1].lastIndexOf(";") + 1);
    rules.push({ selectors: prelude.split(",").map((s) => s.trim()), decls });
  }
  return rules;
}

/** Does a selector apply to <html data-theme=… data-accent=…>? Descendant selectors never do. */
function matches(selector: string, ctx: Ctx): boolean {
  if (!selector.startsWith(":root") || /\s/.test(selector)) return false;
  const attrs: Record<string, string> = { "data-theme": ctx.theme, "data-accent": ctx.accent };
  for (const a of selector.matchAll(/\[([a-z-]+)(\^?=)"([^"]*)"\]/g)) {
    const have = attrs[a[1]];
    if (have === undefined) return false;
    if (a[2] === "=" ? have !== a[3] : !have.startsWith(a[3])) return false;
  }
  return true;
}

const rules = parseTokenBlock();

function resolve(ctx: Ctx): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const r of rules) if (r.selectors.some((s) => matches(s, ctx))) Object.assign(vars, r.decls);
  const out: Record<string, string> = {};
  const get = (name: string, depth = 0): string => {
    const v = vars[name];
    if (v === undefined) throw new Error(`${name} is not defined for ${ctx.theme}/${ctx.accent}`);
    const alias = v.match(/^var\((--[a-z0-9-]+)\)$/);
    return alias && depth < 10 ? get(alias[1], depth + 1) : v;
  };
  for (const k of Object.keys(vars)) out[k] = get(k);
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  for (const c of [a, b]) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error(`not a 6-digit hex colour: ${c}`);
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // WCAG AA, body text
const UI = 3; // WCAG AA, non-text: control outlines, bars, marks

type Pair = [fg: string, bg: string, min: number];

// --zone-fill: the section panel (2026-09-30). Text and accent land on it
// directly, so it is a surface like the others.
const SURFACES = ["--wall", "--wall-2", "--panel", "--plate", "--zone-fill"];

const PAIRS: Pair[] = [
  // base text on every surface it can land on
  ...["--ink", "--ink-2", "--ink-3", "--disabled-ink"].flatMap((fg) =>
    [...SURFACES, "--head-tint", "--note-bg", "--field", "--quiet-hover"].map(
      (bg): Pair => [fg, bg, TEXT],
    ),
  ),
  ["--ink", "--quiet-active", TEXT],
  // state
  ["--ink", "--bad-bg", TEXT],
  ["--bad", "--bad-bg", TEXT],
  ["--ink", "--good-bg", TEXT],
  ["--good", "--good-bg", TEXT],
  ["--good", "--wall", TEXT],
  ["--good", "--panel", TEXT],
  ["--bad", "--wall", TEXT],
  ["--bad", "--panel", TEXT],
  ["--good", "--zone-fill", TEXT],
  ["--bad", "--zone-fill", TEXT],
  ["--good-ink", "--good", TEXT],
  // inverse blocks and the shell
  ["--zone-ink", "--zone-line", TEXT],
  ["--block-ink", "--block", TEXT],
  ["--trim-ink", "--trim", TEXT],
  ["--trim-ink-2", "--trim", TEXT],
  ["--select-ink", "--select-bg", TEXT],
  // accents (FINAL-BRIEF: accent-ink on the three fills, accent-text on every
  // surface, ink on accent-tint) plus ink-2 on tint for the headline panel
  ["--accent-ink", "--accent", TEXT],
  ["--accent-ink", "--accent-hover", TEXT],
  ["--accent-ink", "--accent-active", TEXT],
  ...SURFACES.map((bg): Pair => ["--accent-text", bg, TEXT]),
  ["--ink", "--accent-tint", TEXT],
  ["--ink-2", "--accent-tint", TEXT],
  // non-text
  ["--field-line", "--wall", UI],
  ["--field-line", "--panel", UI],
  ["--edge", "--wall", UI],
  ["--bar", "--bar-track", UI],
  ["--bar", "--wall", UI],
  ["--bar", "--panel", UI],
  ["--accent-mark", "--trim", UI],
];

const combos = THEMES.flatMap((theme) => ACCENTS.map((accent) => ({ theme, accent })));

describe("globals.css token block — WCAG AA", () => {
  it("parses: every theme × accent resolves the core tokens to hex", () => {
    for (const ctx of combos) {
      const t = resolve(ctx);
      for (const k of ["--wall", "--panel", "--ink", "--accent", "--accent-text"]) {
        expect(t[k], `${k} in ${ctx.theme}/${ctx.accent}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it.each(combos)("$theme / $accent: every design pair passes", (ctx) => {
    const t = resolve(ctx);
    const fails = PAIRS
      .map(([fg, bg, min]) => ({ fg, bg, min, r: ratio(t[fg], t[bg]) }))
      .filter((p) => p.r < p.min)
      .map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)} < ${p.min}`);
    expect(fails).toEqual([]);
  });

  it("the parser really cascades: graphite and pitch override the dark wall", () => {
    const wall = (theme: Theme) => resolve({ theme, accent: "blue" })["--wall"];
    expect(new Set(THEMES.map(wall)).size).toBe(THEMES.length);
    // and a dark sub-theme still picks up the shared dark accent block
    expect(resolve({ theme: "dark-pitch", accent: "red" })["--accent"]).toBe(
      resolve({ theme: "dark", accent: "red" })["--accent"],
    );
  });
});
