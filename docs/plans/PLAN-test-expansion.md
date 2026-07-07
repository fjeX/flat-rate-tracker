# PLAN — Test Expansion: OCR parsers + discrepancy logic

**Rank: 3 of 5.** `lib/periods.ts` and `lib/stats.ts` are already covered
(`periods.test.ts`, `stats.test.ts`). The two remaining pools of pure, high-blast-radius
logic have zero tests: the OCR text parsers in `lib/ocr.ts` (feeds the killer scan feature,
and stays load-bearing as the fallback path after PLAN-ocr-claude-vision) and the pay
verdict math currently trapped inside `DiscrepancyCard.tsx`. Cheap to do, protects the
money paths, and makes the other four plans safely executable by a weaker model.

## Goal

1. Unit-test the exported parsing functions in `src/lib/ocr.ts` with realistic noisy OCR
   fixtures.
2. Extract the verdict/parsing logic out of `DiscrepancyCard.tsx` into a pure module and
   test it (component behavior unchanged).

## Exact files to touch

| File | Change |
|---|---|
| `src/lib/ocr.test.ts` | NEW — parser tests |
| `src/lib/discrepancy.ts` | NEW — extracted pure logic |
| `src/lib/discrepancy.test.ts` | NEW — tests |
| `src/components/pay-period/DiscrepancyCard.tsx` | delete local `TOLERANCE`, `Verdict`, `parseHours`, `verdictFor`, `toText`; import them from `@/lib/discrepancy` |

Nothing else. Do not touch `vitest.config.ts` unless a test genuinely fails to run (see
edge case 1 first).

## Implementation order

1. **`src/lib/discrepancy.ts`** — move these verbatim from `DiscrepancyCard.tsx` and
   export them: `TOLERANCE` (0.1), `type Verdict`, `toText`, `parseHours`, `verdictFor`.
   Keep behavior byte-for-byte identical — this is a pure extraction, not a redesign.
2. **`DiscrepancyCard.tsx`** — replace the local definitions with
   `import { TOLERANCE, toText, parseHours, verdictFor, type Verdict } from "@/lib/discrepancy";`
   (drop any of those it doesn't use after the swap; `TOLERANCE` itself may become unused
   in the component — fine, don't import it then).
3. **`src/lib/discrepancy.test.ts`** — cases:
   - `parseHours`: `""` → null, `"  "` → null, `"abc"` → null, `"-1"` → null, `"0"` → 0,
     `"12.5"` → 12.5, `"1e2"` → 100 (Number() accepts it — assert current behavior, it's fine).
   - `verdictFor`: null paid → `"unknown"`; exact match → `"match"`; boundary: paid =
     logged − 0.1 → `"match"`, paid = logged − 0.11 → `"missing"`; paid > logged + 0.1 →
     `"over"`. Use non-round floats (e.g. logged 42.3) to catch float-compare bugs.
4. **`src/lib/ocr.test.ts`** — test only the exported functions `parseOcrText` and
   `extractFieldFromText`. Build a tiny op-code factory first (edge case 2). Cases, all
   derived from behaviors documented in the source:
   - **RO number**: labeled forms `"RO# 123456"`, `"Repair Order: 4567"`, `"WO #98765"`;
     bare `"#123456"` on its own line; region-crop bare digits (via
     `extractFieldFromText(text, "roNumber", [])`); rejects 3-digit and 9-digit runs.
   - **Vehicle**: `"2018 TOYOTA CAMRY LE"` → year/make/model; 2-digit year on the make's
     line: `"18 TOYOTA CAMRY"` → `"2018"`, `"98 HONDA CIVIC"` → `"1998"`; `"CHEVY"` →
     `"Chevrolet"`, `"VW"` → `"Volkswagen"`; make with no model text after it; no make at
     all → all empty strings.
   - **VIN**: clean 17-char VIN; VIN with a space inserted mid-string (documented Tesseract
     behavior); VIN with `I`/`O`/`Q` noise (`"1HGBH41JXMN1O9186"` → the O corrected to 0);
     text with no VIN → `""`. Remember valid VIN chars exclude I, O, Q — build fixtures
     from `[A-HJ-NPR-Z0-9]` only.
   - **Op codes** (via `parseOcrText(text, library)`): exact boundary match `"LOF"`
     surrounded by spaces/punctuation; NO match when embedded in a word (e.g. `"FLOFF"`);
     fuzzy match with one substitution for a 4+ char code (`"RUTATE"` matches library code
     `"ROTATE"`); a 3-char code does NOT fuzzy match (`"LQF"` must not match `"LOF"`);
     look-alike normalization (`"L0F"` with zero matches `"LOF"`).
   - **Confidence**: ≥ 3 of roNumber/year/make/model found → `"high"`; fewer → `"low"`.
5. Run `npm run test` from `projects/flat-rate-tracker/` — all green. Then
   `npx tsc --noEmit` and `npm run lint`.

## Edge cases a weaker model would miss

1. **`lib/ocr.ts` contains browser-only code (`document.createElement`,
   `createImageBitmap`) but only INSIDE `preprocessCrop`/`cropImageRegion`.** Importing the
   module in a Node vitest environment is safe as long as tests never call those two
   functions. Do not add jsdom or a `// @vitest-environment` pragma for this — check how
   `stats.test.ts` runs first and match it.
2. **The `OpCode` type is wide** — fixtures need `id, userId, code, description,
   flagHours, notes, tags, sortOrder, createdAt, subOpCodes`. Write one factory
   `mkOpCode(code: string, over: Partial<OpCode> = {}): OpCode` at the top of the test
   file instead of hand-writing objects, or every future type change breaks 20 fixtures.
3. **`extractOpCodes` matches against BOTH the raw uppercase text and a
   look-alike-normalized copy** (0↔O, 1↔I, 5↔S, 8↔B). When writing "must NOT match"
   cases, make sure the fixture fails in *both* forms, or the test will pass the wrong way.
   E.g. `"L0F"` DOES match `"LOF"` by design — don't write it as a negative case.
4. **The year window split is 29/30**: `"29 FORD"` → 2029 but `"30 FORD"` → 1930. Pin both
   boundaries in tests so nobody "fixes" it blindly later.
5. **2-digit year detection only fires when a known make was found**, and only looks at
   text between the line start and the make. A fixture like `"18\nTOYOTA CAMRY"` (year on
   the previous line) yields NO year — that's current behavior; assert it as such rather
   than "fixing" the fixture.
6. **`verdictFor` boundary uses `<=` with floats**: `42.3 - 42.2 <= 0.1` is FALSE in IEEE
   754 (0.10000000000000142). Pick boundary fixtures that don't rely on exact float
   arithmetic (e.g. logged 42.0, paid 41.9 — also false! `42.0-41.9 = 0.099999...` ≤ 0.1
   is true; verify each chosen pair in a REPL first and assert what the code actually
   does). If a boundary case exposes surprising float behavior, assert the ACTUAL current
   behavior and add a comment — do not change `verdictFor` in this task.
7. **Do not refactor `lib/ocr.ts` to export its private helpers** just to test them —
   test through the public API (`parseOcrText`, `extractFieldFromText`). Private helpers
   are covered transitively.

## Acceptance criteria

- [ ] `npm run test` green; new files add ≥ 25 assertions across the two test files.
- [ ] `DiscrepancyCard.tsx` no longer defines `verdictFor`/`parseHours` locally and the
      Pay Period page renders identically (`npm run dev`, enter paid hours, verdict colors
      unchanged: red missing / yellow over / green match).
- [ ] Boundary tests pin: RO digit-length window (4–8), year window split (29/30), fuzzy
      distance ≤ 1 only for codes ≥ 4 chars, VIN I/O/Q correction, tolerance edges.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- [ ] No production file changed except `DiscrepancyCard.tsx` (extraction only).
