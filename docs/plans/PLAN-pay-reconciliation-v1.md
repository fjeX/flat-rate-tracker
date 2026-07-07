# PLAN — Pay Reconciliation Engine v1 (line-level paid hours)

**Rank: 1 of 5 (highest leverage).** This is the declared "build first" strategic feature
(see `memory/project_frt_defensibility_strategy.md`): the day this catches real shorted
money, the user is locked in.

## Goal

Let a tech record, per op-code line, how many flag hours the shop **actually paid** on that
job, then surface every shorted line in the pay-period view plus a lifetime
"hours/dollars left on the table" counter. Today the app only has a period-level aggregate
check (`DiscrepancyCard`); this adds the per-job ledger that proves *which* RO was shorted.

### Scope decisions already made — do NOT re-open these

Pay structures are messy (warranty splits, skill multipliers, mixed flat/hourly). v1
deliberately ignores all of that:

- One nullable `paid_hours` number per op-code line. `null` = not yet reconciled.
- Status is **derived**, never stored: `pending` (null), `paid` (|paid − flag| ≤ 0.05),
  `short` (paid < flag − 0.05), `over` (paid > flag + 0.05).
- Dollars are computed from a single optional `hourly_rate` in user settings. If unset,
  show hours only — never invent a rate.
- No warranty/comeback categories, no per-line pay rates, no shop-side anything. v2 territory.
- Guest mode gets the schema pass-through but **no reconciliation UI** (guests have no
  pay-period page).

## Exact files to touch

| File | Change |
|---|---|
| `supabase/migrations/20260706000000_line_paid_hours.sql` | NEW — two ALTERs |
| `src/lib/supabase/database.types.ts` | add `paid_hours` to `entry_op_codes` Row/Insert/Update; `hourly_rate` to `user_settings` Row/Insert/Update |
| `src/lib/types.ts` | `paidHours: number \| null` on `EntryOpCode`; `hourlyRate: number \| null` on `UserSettings` |
| `src/lib/reconcile.ts` | NEW — pure status/aggregation functions |
| `src/lib/reconcile.test.ts` | NEW — unit tests |
| `src/lib/db/entries.ts` | map `paid_hours` in `toEntryOpCode` + `toLineInsert`; new `setLinePaidHours` |
| `src/lib/db/settings.ts` | map `hourly_rate` in `toSettings` + `SettingsPatch` + `updateSettings` |
| `src/app/actions/entries.ts` | new `setLinePaidHoursAction` (mirror `setLineActualHoursAction`) |
| `src/app/actions/settings.ts` | accept `hourlyRate` in the settings patch action (follow existing pattern in that file) |
| `src/components/pay-period/ReconciliationCard.tsx` | NEW — the per-line ledger UI |
| `src/components/pay-period/PayPeriodView.tsx` | render `ReconciliationCard` below `DiscrepancyCard`; pass entries + hourlyRate |
| `src/app/(app)/pay-period/page.tsx` | pass `settings.hourlyRate` down (settings are already loaded here or load via `db.getSettings`) |
| `src/components/settings/HourlyRateCard.tsx` | NEW — copy the structure of `GoalHoursCard.tsx` |
| `src/app/(app)/settings/page.tsx` | render `HourlyRateCard` |
| `src/components/forms/LogRoForm.tsx` | carry `paidHours` through line drafts (see edge case 1 — critical) |
| `src/lib/guest/context.tsx` | if guest entry lines are built from `NewEntryOpCode`, default `paidHours: null` wherever lines are constructed |

## Implementation order

1. **Migration** — `supabase/migrations/20260706000000_line_paid_hours.sql`:
   ```sql
   -- Per-line reconciliation: flag hours the shop actually paid for this job.
   ALTER TABLE entry_op_codes
     ADD COLUMN IF NOT EXISTS paid_hours numeric(5,2);
   -- Optional hourly rate to convert shorted hours into dollars.
   ALTER TABLE user_settings
     ADD COLUMN IF NOT EXISTS hourly_rate numeric(6,2);
   ```
   Apply locally with `npx supabase start` running, or however local dev DB is running
   (`docker exec supabase-db psql ...` on the VM happens later via the /rebuild + /migrate skills — do NOT touch the VM in this task).
2. **`database.types.ts`** — hand-edit: add `paid_hours: number | null` to
   `entry_op_codes` `Row`, and `paid_hours?: number | null` to `Insert` and `Update`.
   Same shape for `hourly_rate` on `user_settings`. Match the file's existing style exactly.
3. **`types.ts`** — add fields as above. This will produce compile errors everywhere an
   `EntryOpCode`/`NewEntryOpCode` literal is built — let `npx tsc --noEmit` be your todo
   list; fix every site with `paidHours: null` (or a pass-through of an existing value).
4. **`lib/reconcile.ts`** — pure, no imports beyond types:
   ```ts
   export type PayStatus = "pending" | "paid" | "short" | "over";
   export const PAY_EPS = 0.05;
   export function payStatus(flag: number, paid: number | null): PayStatus;
   // Aggregate over entries: total flagged, total paid (nulls excluded),
   // shortedHours (sum of flag−paid where status === "short"),
   // pendingCount, shortLineCount.
   export function reconcileEntries(entries: Entry[]): ReconcileSummary;
   export function shortfallDollars(shortedHours: number, hourlyRate: number | null): number | null;
   ```
5. **`lib/reconcile.test.ts`** — cover: null paid → pending; exact match → paid; paid at
   tolerance boundary (flag 1.0, paid 0.95 → paid; paid 0.94 → short); over; mixed entries
   aggregation; `shortfallDollars(2, null) === null`. Run `npm run test`.
6. **db layer** — `entries.ts`: `paidHours` in `toEntryOpCode`
   (`row.paid_hours === null ? null : Number(row.paid_hours)`), pass through in
   `toLineInsert` (only set when non-null, like `sub_op_code_id`, so old DBs don't break).
   New `setLinePaidHours(supabase, lineId, paidHours)` — copy `setLineActualHours`.
   `settings.ts`: map `hourly_rate`, extend `SettingsPatch`.
7. **Server actions** — `setLinePaidHoursAction` in `actions/entries.ts`: validate
   non-negative finite or null, call db, then `revalidatePath` for `/`, `/history`,
   `/pay-period` (copy the existing action). Extend the settings action for `hourlyRate`
   (validate `null` or `0 < rate < 1000`).
8. **`ReconciliationCard.tsx`** (client component) — props:
   `{ entries: Entry[]; hourlyRate: number | null }`. Renders:
   - Summary row: shorted hours this period (red when > 0), pending line count, and
     dollars (only when `hourlyRate` set): `$${(shortedHours * hourlyRate).toFixed(2)}`.
   - A list of every line with status `pending` or `short`: RO#, op code label (resolve the
     same way `RoList` does — library code, custom code, or sub-op code), flag hours, and a
     small paid-hours `<input type="number">` that saves on blur/Enter via
     `setLinePaidHoursAction` inside `useTransition` — copy the exact save pattern from
     `DiscrepancyCard.tsx` (paidText state, `commit()`, dirty check, error text).
   - A "Mark all remaining as paid in full" button: for every pending line, call
     `setLinePaidHoursAction(line.id, line.flagHours)` sequentially; show a pending spinner.
   - Empty state: if no pending/short lines, one green line "All jobs reconciled for this
     period." Use the existing `EmptyState` component only if it fits visually; a single
     `<p>` is fine.
   - Style: match `DiscrepancyCard` (zinc-900 card, `text-[10px] uppercase` labels,
     red-400/green-400 accents).
9. **Wire up** — `PayPeriodView.tsx` already has the period's entries (it renders the RO
   list); pass them plus `hourlyRate` into `<ReconciliationCard>` directly below
   `<DiscrepancyCard>`. Add `key={selected.key}` like `DiscrepancyCard` has, so per-period
   state resets on period switch.
10. **Settings card** — `HourlyRateCard.tsx`: clone `GoalHoursCard.tsx` structure/styling,
    label "Hourly flag rate ($/hr)", helper text "Optional — used to show shorted pay in
    dollars on the Pay Period page." Empty input saves `null`.
11. **LogRoForm pass-through** — see edge case 1. Then `npx tsc --noEmit`, `npm run lint`,
    `npm run test`, `npm run build` — all must be green.

## Edge cases a weaker model would miss

1. **`updateEntry` deletes and re-inserts all lines** (`src/lib/db/entries.ts` — "delete
   existing lines and re-insert"). If `LogRoForm`'s line drafts don't carry `paidHours`,
   **editing any RO silently wipes its reconciliation data**. Fix: in `LogRoForm.tsx`, the
   `LineDraft` type must gain `paidHours: number | null`, seeded from the entry line when
   entering edit mode (exactly like `actualHours` is), defaulted to `null` for new lines,
   and included when building `NewEntryOpCode[]` for `saveEntry`. Do NOT render an input
   for it in the form — pure pass-through.
2. **A DB trigger recomputes `entries.flag_hours` from lines** — do not try to
   denormalize paid totals onto `entries`; always derive from lines in `lib/reconcile.ts`.
3. **Old-DB safety pattern**: `toLineInsert` only includes optional columns when set
   (see the `sub_op_code_id` comment). Follow it for `paid_hours` so the app doesn't 500
   against a DB that hasn't run the migration yet (this exact failure caused the 2026-05-06
   production incident — see `docs/incidents.md`).
4. **`getSettings` has a no-row fallback object** (`src/lib/db/settings.ts` line ~43) —
   add `hourlyRate: null` there too, or fresh accounts crash.
5. **Numeric strings from Postgres**: numeric columns come back as strings through
   PostgREST — always wrap with `Number(...)` in mappers (the file already does this for
   `flag_hours`; copy it).
6. **Don't touch `DiscrepancyCard`'s tolerance (0.1)** — it's a period-level aggregate
   with its own semantics. The line-level `PAY_EPS = 0.05` is intentionally different.
7. **Lines with status `over`** should still disappear from the "needs attention" list
   (they're reconciled — the tech got paid more, fine), but count them in the summary so
   totals stay honest.
8. **Custom lines have `opCodeId: null`** — resolve display labels via
   `customCode`/`customDescription`, and sub-op-code lines via `subOpCodeId`. Look at how
   `RoList.tsx` resolves chip labels and reuse that logic (extract a helper if needed).

## Acceptance criteria

- [ ] `npm run test` green, including new `reconcile.test.ts` (≥ 8 cases incl. tolerance boundaries).
- [ ] `npx tsc --noEmit` and `npm run lint` clean; `npm run build` succeeds.
- [ ] Manual (`npm run dev`, signed-in account): log an RO with 2 op codes → Pay Period
      page shows both lines as pending; enter paid hours lower than flag on one → line
      shows short, summary shows shorted hours in red; set hourly rate in Settings →
      dollars appear; "Mark all remaining as paid" clears pending list.
- [ ] Edit that RO in the Log form (change vehicle only) and save → paid hours are STILL
      there on the Pay Period page (edge case 1 regression check).
- [ ] Guest mode (`/guest/log`) still logs entries without errors.
- [ ] Migration file exists and was applied to the local dev DB; NOT applied to the VM
      (deployment is a separate /rebuild step Liem runs).
