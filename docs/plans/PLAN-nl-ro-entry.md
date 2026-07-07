# PLAN — Natural Language RO Entry

**Rank: 4 of 5. Prerequisite: PLAN-ocr-claude-vision must be done first** — it creates
`src/lib/claude.ts`, the `ANTHROPIC_API_KEY` plumbing, and the auth-gated-action pattern
this plan reuses. Do not start this plan until that one is merged.

## Goal

On the Log RO page (signed-in only), a tech can type or dictate one line —

> "2021 RAV4, RO 88421, 180k miles, oil change and rear brakes, customer states squealing"

— hit **Fill form**, and the existing form prefills: RO#, vehicle, mileage, matched
library op codes as lines, unmatched jobs as custom one-time lines, and the free-text
remainder into Notes. The tech reviews and saves as usual. No new save path — this is a
prefill layer on top of the existing form, exactly like the scan feature.

## Exact files to touch

| File | Change |
|---|---|
| `src/app/actions/parse-entry.ts` | NEW — `parseEntryTextAction(text, todayIso)` server action |
| `src/components/forms/QuickEntryBar.tsx` | NEW — textarea + Fill form button |
| `src/components/forms/LogRoForm.tsx` | render `QuickEntryBar` (new-RO mode + `visionEnabled` only); add `handleParsedEntry` applying the result |

Nothing else changes. Reuse `isClaudeConfigured()` gating already wired through
`visionEnabled` on `LogRoForm` (from the OCR plan) — same flag gates this feature, no new
prop needed.

## Implementation order

1. **Shared result type** — define in `parse-entry.ts` and export:
   ```ts
   export type ParsedEntryDraft = {
     roNumber: string;        // "" if not stated
     date: string;            // "YYYY-MM-DD" or "" (only when explicitly stated)
     vehicle: { year: string; make: string; model: string; vin: string; mileage: string };
     matchedOpCodes: string[];   // library CODES (strings, not ids)
     customJobs: { description: string }[]; // jobs not in the library
     notes: string;           // leftover context, e.g. "customer states squealing"
   };
   ```
2. **`parseEntryTextAction(text: string, todayIso: string): Promise<ParsedEntryDraft>`**:
   - `"use server"`, auth-gate with `supabase.auth.getUser()` (copy from `actions/scan.ts`).
   - Reject empty/whitespace text and text > 1000 chars.
   - Load the library server-side (`db.listOpCodes(supabase)` — check the actual export
     name in `src/lib/db/op-codes.ts`) rather than trusting a client-provided list.
   - Call `claudeClient().messages.create`, model `"claude-haiku-4-5"`, `max_tokens: 1024`,
     forced tool `report_entry` whose input schema mirrors `ParsedEntryDraft` (snake_case
     fields are fine; map them back). Prompt includes: today's date (`todayIso`, passed
     from the client so it's the USER'S local today, not the server's — see edge case 3),
     the library as `CODE — description` lines, and rules:
     - "Match jobs to library codes by meaning ('oil change' → LOF 'Lube, Oil, Filter').
       A job goes in matched_op_codes ONLY if a library code clearly covers it; otherwise
       put a short description in custom_jobs. Never invent codes."
     - "mileage: digits only, expand shorthand ('180k' → '180000')."
     - "date: empty string unless the text explicitly names a day; resolve relative words
       ('yesterday') against the provided today date."
     - "Never guess flag hours; you have no field for them on purpose."
     - "notes: complaint/context wording (e.g. 'customer states…'), not the job list."
   - Post-validate (mirror the scan action): year `/^(19|20)\d{2}$/` or `""`; date
     `/^\d{4}-\d{2}-\d{2}$/` or `""`; VIN 17-char charset or `""`; matched codes filtered
     to ones that really exist in the library (case-insensitive trim compare); cap
     `customJobs` at 10.
3. **`QuickEntryBar.tsx`** (`"use client"`): a collapsed one-line affordance ("⚡ Quick
   entry — describe the RO in plain words") that expands to a textarea + "Fill form"
   button + hint text "e.g. 2021 RAV4, RO 88421, 180k, oil change and rear brakes".
   On submit: `useTransition`, call the action with `text` and local today
   (`isoDate(new Date())` from `@/lib/periods` — same helper the form uses), pass result
   to an `onParsed` prop, show errors inline in red (match `DiscrepancyCard`'s error
   style). Disable the button while pending and when the textarea is empty. Style like the
   existing `scan-banner` block in `LogRoForm.tsx` so the two assist features read as
   siblings.
4. **`LogRoForm.tsx`** — render `<QuickEntryBar onParsed={handleParsedEntry} />` directly
   under the scan banner, inside the same `!isEdit` guard, additionally guarded by
   `visionEnabled`. Implement `handleParsedEntry(d: ParsedEntryDraft)` next to
   `handleScanResult` and mirror its style:
   - Non-empty fields only: `setRoNumber`, `setYear`, `setMake`, `setModel`, `setVin`,
     mileage setter, and the date setter when `d.date` is set.
   - Matched codes → library IDs (case-insensitive compare), then append lines exactly the
     way `handleScanResult` builds `LineDraft`s from `opCodeIds` (skip codes already in
     `lines`, seed flag hours from the library defaults).
   - `customJobs` → append custom `LineDraft`s: `custom: true`,
     `customCode: ""`, `customDescription: job.description`, `flagHours: 0` (the tech
     fills the real flag; never invent hours). Look at how `CustomOpCodeModal`'s result is
     turned into a line and reuse that exact shape.
   - `d.notes` → only set if the notes field is currently empty (never clobber typed notes).

## Edge cases a weaker model would miss

1. **Don't create a second save path.** The output is form state, nothing more. All
   validation, duplicate-RO checking (`findDuplicateRos` flow), and saving stay in the
   existing form logic untouched.
2. **Flag hours must never come from the model.** Matched codes inherit the library
   default (that's user-curated data); custom jobs get 0 and require manual entry. A model
   guessing "rear brakes ≈ 1.3h" writes plausible-looking wrong pay data — the one
   unforgivable failure mode in a pay-tracking app.
3. **"Yesterday" depends on the user's midnight, not the server's.** The server action
   must not call `new Date()` for "today" — the client passes `isoDate(new Date())`.
   (Server validates the format and, if invalid, falls back to server today.)
4. **Library must be loaded server-side inside the action.** Passing the library from the
   client both bloats the request and lets a tampered request inject codes; the server
   already has an authed Supabase client — use it.
5. **Duplicate lines**: parsing "oil change and tire rotation" twice (user edits text,
   resubmits) must not double the lines — the skip-if-already-present check from
   `handleScanResult` (`lines.some(l => l.opCodeId === id)`) handles matched codes; for
   custom jobs, skip when a custom line with the same `customDescription`
   (case-insensitive) already exists.
6. **Guest mode and edit mode never show the bar** — same `!isEdit` guard as the scan
   banner PLUS the `visionEnabled` guard (guests get `visionEnabled=false` from the OCR
   plan wiring; keep it that way to protect API credits).
7. **Dictation needs no code**: iOS/Android keyboard mic keys dictate into any textarea.
   Do not add a Web Speech API integration — it's flaky in exactly the environment
   (shop floor, gloves, noise) this feature targets.
8. **The mileage field setter**: `LogRoForm` manages vehicle fields as separate state
   hooks — find the mileage one by reading the file (search `mileage`), don't assume its
   name.

## Acceptance criteria

- [ ] Signed in with API key set: typing the example sentence and clicking Fill form
      populates RO# 88421, year 2021, model RAV4 (make may be empty or Toyota — accept
      either, Claude usually infers Toyota; assert only that stated fields land), mileage
      180000, an LOF-equivalent library line (given one exists in the library) with its
      library default flag hours, a rear-brakes line (library `BRK-R` if present, else a
      custom line with flagHours 0), and "customer states squealing" in Notes.
- [ ] Resubmitting the same text does not duplicate lines.
- [ ] Manually typed notes are not overwritten by a later parse.
- [ ] Bar is absent: in edit mode, in guest mode, and when `ANTHROPIC_API_KEY` is unset.
- [ ] Empty text → button disabled; 1500-char text → readable inline error.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build` all clean.
