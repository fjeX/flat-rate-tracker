# PLAN — Replace Tesseract OCR with Claude Vision

**Rank: 2 of 5.** The scan-to-log feature is the app's killer feature, and the current
Tesseract + hand-drawn-region pipeline is brittle (different shop RO formats break it).
This swaps the primary path to a Claude API vision call and keeps Tesseract as the offline/
guest fallback. It also builds the server-side Anthropic client that PLAN-nl-ro-entry and
PLAN-insights-page reuse — do this before those two.

## Goal

Signed-in users tap "Scan RO", the photo goes to a server action that calls Claude
(`claude-haiku-4-5`) with the image + the user's op-code library, and gets back structured
`{ roNumber, year, make, model, vin, mileage, opCodes[] }`. No templates, no region
drawing, no PSM tuning. Guests and any API failure fall back to the existing Tesseract path
unchanged.

## Exact files to touch

| File | Change |
|---|---|
| `package.json` | add `@anthropic-ai/sdk` dependency |
| `.env.example` | document `ANTHROPIC_API_KEY=` (server-only, runtime) |
| `next.config.ts` | raise server-action body size limit (see edge case 1) |
| `src/lib/claude.ts` | NEW — server-only Anthropic client factory + `isClaudeConfigured()` |
| `src/app/actions/scan.ts` | NEW — `scanRoImageAction(fd: FormData)` server action |
| `src/lib/scan-image.ts` | NEW — client-side downscale/re-encode helper |
| `src/components/forms/ScanRoButton.tsx` | vision-first flow with Tesseract fallback |
| `src/components/forms/LogRoForm.tsx` | pass a `visionEnabled` prop down to `ScanRoButton`; extend `handleScanResult` for mileage |
| `src/app/(app)/log/page.tsx` | pass `visionEnabled` (server knows if key is configured) |
| `src/app/guest/log/page.tsx` | pass `visionEnabled={false}` |

Do NOT delete `src/lib/ocr.ts`, the `tesseract.js` dependency, `RoTemplateEditor`, or the
template settings card — they are the fallback and stay fully functional.

## Implementation order

1. `npm install @anthropic-ai/sdk` (run inside `projects/flat-rate-tracker/`).
2. **`src/lib/claude.ts`** (must have `import "server-only"` at top, or at minimum never be
   imported from a client component):
   ```ts
   import Anthropic from "@anthropic-ai/sdk";
   export function isClaudeConfigured(): boolean {
     return !!process.env.ANTHROPIC_API_KEY;
   }
   export function claudeClient(): Anthropic {
     return new Anthropic(); // reads ANTHROPIC_API_KEY from env
   }
   ```
3. **`next.config.ts`** — add:
   ```ts
   experimental: { serverActions: { bodySizeLimit: "8mb" } },
   ```
   (merge into the existing exported config object, don't replace it).
4. **`src/lib/scan-image.ts`** — client helper `prepareScanImage(file: File): Promise<Blob>`:
   `createImageBitmap(file)` → if the long side > 1568px, scale down so long side = 1568
   (Claude's optimal vision resolution) → canvas → `toBlob("image/jpeg", 0.85)`. If
   `createImageBitmap` throws (unsupported format), return the original file untouched and
   let the server reject it if needed. Reuse the canvas patterns already in `lib/ocr.ts`
   (`cropImageRegion`) as a style reference.
5. **`src/app/actions/scan.ts`** — `"use server"`:
   - Auth gate FIRST: `const supabase = await createClient(); const { data: { user } } =
     await supabase.auth.getUser(); if (!user) throw new Error("Sign in to use AI scan.");`
   - Read `image` (File/Blob) and `libraryCodes` (JSON string of
     `{ code, description }[]`) from the FormData. Reject images > 5 MB.
   - Convert to base64, detect media type from `blob.type` (only allow
     `image/jpeg|png|webp|gif`; anything else → throw with a friendly message).
   - Call `claudeClient().messages.create` with model `"claude-haiku-4-5"`,
     `max_tokens: 1024`, one user message containing the image block + a text prompt, and
     **force structured output via a single tool** named `report_ro` with an input schema:
     `ro_number: string`, `year: string` ("4-digit; if the RO shows a 2-digit year, expand
     it: 00–29 → 20xx, 30–99 → 19xx"), `make: string`, `model: string`, `vin: string`
     ("17 chars, uppercase, never contains I, O, or Q; empty string if not fully legible"),
     `mileage: string`, `op_codes: string[]` ("ONLY codes from the provided library list
     that appear on this RO — never invent codes"). Set `tool_choice: { type: "tool",
     name: "report_ro" }`.
   - Prompt text: "This is a photo of an automotive repair order. Extract the fields. The
     technician's op code library is: <list of `CODE — description`>. Match op codes
     against that list only. Use empty strings for anything not present or unreadable."
   - Post-validate server-side (edge case 3) and return a plain object shaped like
     `lib/ocr.ts`'s `OcrResult` plus `mileage`: map matched code strings back to nothing —
     return the **code strings**; the client maps them to library IDs (edge case 4).
     Set `confidence: "high"` if ≥ 3 of roNumber/year/make/model are non-empty, else `"low"`.
6. **`ScanRoButton.tsx`** — add prop `visionEnabled: boolean`. In `handleFile`:
   - If `visionEnabled`: `prepareScanImage(file)` → build FormData → `scanRoImageAction`.
     On success, map returned op-code strings to library IDs
     (`library.find(o => o.code.trim().toUpperCase() === returned.trim().toUpperCase())`),
     build the `OcrResult`, call `onResult`, set the summary UI exactly as today. Populate
     the existing debug panel with one entry showing what the model returned so the "Scan
     details" affordance still works.
   - On ANY error from the vision path (network, action throw, key missing): log nothing
     sensitive, show no error yet — **fall through to the existing Tesseract branch** and
     only surface an error if that also fails.
   - If `!visionEnabled`: current behavior, untouched (template picker + Tesseract).
   - Template picker: when `visionEnabled`, skip the template picker entirely (vision
     doesn't need templates) — go straight to the file input.
7. **Wiring** — `LogRoForm` gets `visionEnabled?: boolean` prop (default false) and passes
   it through. `app/(app)/log/page.tsx` is a server component: import
   `isClaudeConfigured` from `lib/claude` and pass `visionEnabled={isClaudeConfigured()}`.
   Guest page passes nothing (defaults false). Extend `handleScanResult` in `LogRoForm` to
   also `setMileage(result.mileage)` when present (the form already has a mileage field —
   find its setter).
8. **Env plumbing** — add `ANTHROPIC_API_KEY=` to `.env.example` with a comment that it is
   optional (app falls back to on-device OCR), server-side only, and read at **runtime**
   (on the VM it goes in `.env` and needs `docker compose up -d` to recreate the container
   — but also check `docker-compose.yml` passes it through to the app container's
   `environment:` section; if the compose file only passes specific vars, add
   `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` there).
9. Verify: `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build`.

## Edge cases a weaker model would miss

1. **Next.js server actions cap request bodies at 1 MB by default.** A phone photo is
   3–10 MB. Without the `bodySizeLimit` bump AND the client-side downscale, every scan
   fails with an opaque body-size error. Do both (downscale for cost/latency, limit bump
   as safety margin).
2. **Guests must never reach the Claude action.** Server actions are public POST
   endpoints; the auth gate inside the action is the real protection (the `visionEnabled`
   prop is just UX). Without the in-action `getUser()` check, anyone can burn API credits
   unauthenticated.
3. **Validate, don't trust, the model output**: VIN must match
   `/^[A-HJ-NPR-Z0-9]{17}$/` after uppercasing (else return `""`); year must match
   `/^(19|20)\d{2}$/` (else `""`); RO number: strip a leading `#` and whitespace. Claude
   with a forced tool still occasionally returns near-miss strings.
4. **Return op codes as strings, map to IDs client-side.** Never send library UUIDs to
   the model or ask it to return them — it will hallucinate plausible-looking IDs. Codes
   are short and verifiable; unmatched codes are silently dropped.
5. **iPhone HEIC**: Safari decodes HEIC in `createImageBitmap` (so the canvas re-encode to
   JPEG fixes it transparently), Chrome desktop does not. The `prepareScanImage` fallback
   returns the raw file, whose type `image/heic` the server rejects with a readable message
   ("Photo format not supported — retake as JPEG or screenshot it"). Don't try to add a
   HEIC decoder dependency.
6. **The Anthropic SDK must never be imported into client code** — `ScanRoButton` is
   `"use client"`; it may only import the action from `app/actions/scan.ts` and the pure
   helper from `lib/scan-image.ts`. Importing `lib/claude.ts` from a client file will leak
   the dependency into the browser bundle or crash the build.
7. **Missing API key ≠ broken app.** `isClaudeConfigured()` gates the UI, and the fallback
   chain (vision error → Tesseract) covers a key that exists but is invalid/expired. The
   app must behave exactly as today when no key is set — that's also what CI/builds see.
8. **Model ID**: use `"claude-haiku-4-5"` (cheap, vision-capable). Do not use an opus/
   sonnet model — a scan should cost a fraction of a cent.
9. **`e.target.value = ""` reset** at the top of `handleFile` must stay — it lets the same
   photo be re-picked after a failed scan.

## Acceptance criteria

- [ ] `npm run build` green with NO `ANTHROPIC_API_KEY` in the environment.
- [ ] With a key in `.env.local`: sign in, Log RO → Scan RO on a sample RO photo →
      RO#, vehicle, VIN, mileage and matching library op codes prefill; summary chip shows.
- [ ] With the key removed: same flow silently uses Tesseract (template or full-image) —
      no user-visible AI error.
- [ ] Guest `/guest/log` scan works exactly as before (Tesseract), and calling the scan
      action without a session throws (verify by temporarily invoking it signed out or by
      code inspection of the auth gate).
- [ ] An oversized photo (> 5 MB after prepare) gets a readable error, not a crash.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test` all clean.
- [ ] `.env.example` documents the new var; `docker-compose.yml` passes it through.
