# FRT — Future Ideas (Fable 5 Candidates)

Collected 2026-06-10. These are potential enhancements to explore once the production audit is done.

---

## Deferred Production Audit Fixes

These were identified in the 2026-06-10 production audit and not yet resolved. They each require more than a targeted edit. Address these before the feature ideas below.

### A. Test Suite Setup (Vitest)

**Current state:** Zero tests anywhere in the codebase.

**What to do:**
1. Install Vitest + `@vitejs/plugin-react` as dev dependencies
2. Add a `vitest.config.ts` at the project root
3. Write unit tests for `src/lib/periods.ts` — focus on period boundary edge cases (end of month, split day = 1, split day = 30, leap years, period overrides)
4. Write unit tests for `src/lib/stats.ts` — aggregateStats with empty entries, zero hours, efficiency calculation when clocked hours are 0
5. Add a `test` script to `package.json`

**Why:** These are pure functions with no external dependencies. If they break, everything breaks silently. Easy to test, high value.

---

### B. Pagination on History and Pay-Period Pages

**Current state:** Both pages call `db.listEntries(supabase)` with no limit — loads all entries for the user on every page load. Will degrade as data grows.

**What to do:**
1. Add optional `limit` and `offset` params to `listEntries` in `src/lib/db/entries.ts`
2. In `src/app/(app)/history/page.tsx` — load a bounded default set (e.g., last 90 days or last 100 entries); pass a `hasMore` flag to the view
3. In `src/components/history/HistoryView.tsx` — add a "Load more" button that fetches the next page (client-side or via a new server action)
4. Pay-period page only needs entries within the current + adjacent periods — add a date range filter to its `listEntries` call

**Note:** Don't over-engineer this. Simple limit/offset is fine — no need for cursor-based pagination.

---

### C. GOAL_HOURS Per-User (DB Migration Required)

**Current state:** `const GOAL_HOURS = 88` is hardcoded in `src/app/(app)/dashboard/page.tsx` line 96. All users see the same goal regardless of their actual target.

**What to do:**
1. Write a new Supabase migration to add `goal_hours integer NOT NULL DEFAULT 88` to the `user_settings` table
2. Update `src/lib/db/settings.ts` — add `goalHours` to `toSettings()` mapper and `SettingsPatch` type
3. Update `src/lib/types.ts` — add `goalHours: number` to `UserSettings`
4. Replace the hardcoded `GOAL_HOURS = 88` in `dashboard/page.tsx` with `settings.goalHours`
5. Add a settings card in `src/app/(app)/settings/page.tsx` to let the user update their goal

**Migration file location:** `supabase/migrations/` — follow the existing timestamp naming pattern.

---

### D. RO Template Orphaned Storage

**Current state:** In `src/components/settings/RoTemplateEditor.tsx`, the image upload to Supabase Storage happens client-side. If the subsequent `saveRoTemplateMetadata` server action fails, the uploaded file is stranded in storage with no DB reference.

**What to do:**
- Option A (preferred): Move the storage upload into the server action so upload + DB write happen in the same server-side call. The component sends the file as FormData, the action uploads it then writes the DB row.
- Option B (simpler): In the client-side catch block after the server action fails, call a `deleteStorageFileAction` to clean up the orphaned upload.

**Files affected:** `src/components/settings/RoTemplateEditor.tsx`, `src/app/actions/ro-template.ts`

---

### E. reorderOpCodes N+1 → Postgres RPC

**Current state:** `reorderOpCodes` in `src/lib/db/op-codes.ts` fires one `UPDATE` query per op code in parallel (N round trips). Added a `user_id` filter in the 2026-06-10 audit but the N+1 pattern remains.

**What to do:**
1. Write a Postgres function (RPC) that accepts an array of `(id uuid, sort_order int)` pairs and updates them in a single query using `unnest`
2. Add it as a new migration in `supabase/migrations/`
3. Update `reorderOpCodes` to call `supabase.rpc("reorder_op_codes", { updates: [...] })` instead of the parallel map

**Example RPC:**
```sql
CREATE OR REPLACE FUNCTION reorder_op_codes(updates jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE op_codes oc
  SET sort_order = (u->>'sort_order')::int
  FROM jsonb_array_elements(updates) AS u
  WHERE oc.id = (u->>'id')::uuid
    AND oc.user_id = auth.uid();
END;
$$;
```

---

---

## 1. OCR Replacement — Claude Vision as the Parser

**Current state:** Tesseract.js with manually defined field regions. Brittle — different RO formats from different shops break it.

**The idea:** Replace with a Claude API vision call.
- User snaps a photo of the RO
- Image sent to Claude (claude-haiku-4-5 for cost efficiency)
- Claude returns structured JSON: `{ ro_number, vehicle, op_codes[] }`
- No templates, no region training — reads it like a human would

**Why it matters:** The scan-to-log feature is one of the killer features of this app. Making it reliable regardless of shop format or scan quality turns it from a cool demo into a daily driver.

**Files most affected:** `src/lib/ocr.ts`, `src/components/forms/ScanRoButton.tsx`, `src/app/actions/ro-template.ts`, settings RO template card

---

## 2. Shop Intelligence — AI Insights on Your Data

**The idea:** A dedicated Insights page powered by Claude API. Export entries + stats as structured context, get back real analysis:
- Flag efficiency by op code (which jobs consistently eat more time than flag)
- Best/worst days and patterns over time
- "These 3 op codes are killing your efficiency ratio"
- Pay period forecasting: probability of hitting goal based on current pace + historical variance
- Dealer vs. independent shop performance breakdown

**Why it matters:** This is the kind of analysis shop managers pay consultants for — built into your own app, running on your own data.

**New surface needed:** `/insights` page, a stats aggregation layer, Claude API integration

---

## 3. Natural Language RO Entry

**The idea:** Instead of filling out the log form field-by-field, type or dictate:

> "2021 RAV4, RO 88421, 180k miles, oil change and rear brakes, customer states squealing"

Claude parses that into the structured form, pre-fills everything, you confirm and submit. Single Claude API call mapping free text to the `Entry` type.

**Why it matters:** Logging friction is real at the end of a long day. Dictate it, confirm it, done.

**Files most affected:** `src/components/forms/LogRoForm.tsx`, new server action or client-side Claude call

---

## 4. Full Test Suite

**Current state:** Zero tests.

**The idea:** One Fable 5 pass to generate:
- Unit tests for `src/lib/periods.ts` and `src/lib/stats.ts` (pure functions, high impact, bugs here affect everything)
- Integration tests for server actions (`entries.ts`, `op-codes.ts`, `settings.ts`)
- Component tests for key UI flows (log form, op code modal, dashboard)

**Why it matters:** Makes the app genuinely production-grade. Fable 5 reads the code, understands intent, and writes tests that cover real edge cases — not just happy paths.

---

## Priority Order (suggested)

1. Production audit (in progress — see audit prompt)
2. OCR vision replacement (highest user-facing impact, low architectural risk)
3. Test suite (production-grade quality gate)
4. Natural language entry (QoL, medium complexity)
5. Shop intelligence (most complex, highest ceiling)
