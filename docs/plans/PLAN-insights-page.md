# PLAN — Insights Page v1 (Shop Intelligence)

**Rank: 5 of 5 — highest ceiling, do last.** Depends on nothing for its core (the numbers
are computed locally), but the optional AI summary section reuses `src/lib/claude.ts` from
PLAN-ocr-claude-vision. If that plan isn't done, build this WITHOUT step 7 and leave a
`// TODO(claude-summary)` marker.

## Goal

A signed-in `/insights` page that answers, from the tech's own logged data: *which op
codes eat more time than they flag, which days/periods are strongest, and whether
efficiency is trending up or down.* v1 is deterministic math computed in
`src/lib/insights.ts` (pure + tested), rendered as simple cards/tables. An optional
Claude-written narrative paragraph sits at the top when an API key is configured.

## Exact files to touch

| File | Change |
|---|---|
| `src/lib/insights.ts` | NEW — pure aggregation functions |
| `src/lib/insights.test.ts` | NEW — unit tests |
| `src/app/(app)/insights/page.tsx` | NEW — server component: load data, compute, render |
| `src/components/insights/InsightsView.tsx` | NEW — presentation (client only if interactivity is added; prefer server) |
| `src/app/actions/insights.ts` | NEW (optional step 7) — `generateInsightsSummaryAction` |
| `src/components/layout/Nav.tsx` | add Insights to the desktop top tabs |
| `src/components/layout/Header.tsx` | add Insights icon link to `.header-mobile-only` group |

## Implementation order

1. **Read first**: `src/app/(app)/dashboard/page.tsx` (how a page loads entries + clocks +
   settings and computes stats), `src/lib/stats.ts`, `src/components/dashboard/StatCard.tsx`
   and `AveragesChart.tsx` (visual language), `Nav.tsx`/`Header.tsx` (tab + mobile-icon
   patterns from the redesign).
2. **`src/lib/insights.ts`** — pure functions over `Entry[]`, `DailyClock[]`, and the
   op-code library:
   ```ts
   // Per-op-code: how logged actual time compares to flag across all uses.
   export type OpCodePerformance = {
     key: string;           // library id, or "custom:<code>" for custom lines
     code: string; description: string;
     uses: number;          // total lines
     timedUses: number;     // lines with actualHours != null
     flagTotal: number; actualTotal: number; // over timed lines only
     ratio: number | null;  // actualTotal / flagTotal over timed lines; null if timedUses === 0 or flagTotal === 0
   };
   export function opCodePerformance(entries: Entry[], library: OpCode[]): OpCodePerformance[];

   // Efficiency by weekday (0=Sun..6=Sat): flag vs clocked summed per weekday.
   export function weekdayEfficiency(entries: Entry[], clocks: DailyClock[]): Array<{ weekday: number; flagHours: number; clockedHours: number; efficiency: number | null }>;

   // Efficiency per pay period, oldest→newest, for the trend line.
   // Reuse grouping from lib/periods.ts (periodKeyFor / periodRange — check real names).
   export function periodTrend(entries: Entry[], clocks: DailyClock[], settings: UserSettings): Array<{ key: string; label: string; efficiency: number | null; flagHours: number }>;
   ```
   Reuse `computeEfficiency` from `lib/stats.ts`; do not duplicate it.
3. **`insights.test.ts`** — cover: op code used 3× but timed once (ratio from the timed
   line only); zero timed uses → ratio null; custom lines grouped by `customCode` not
   lumped together with library lines; weekday parsing of `"YYYY-MM-DD"` (see edge case 1);
   empty entries → empty arrays, no NaN anywhere (assert with `Number.isNaN` sweeps).
4. **Page** — `app/(app)/insights/page.tsx`, server component modeled on the dashboard
   page: `createClient()` → load ALL entries (`db.listEntries(supabase)` with no
   limit — see edge case 3), clocks (find how dashboard loads them — `lib/db/daily-clock.ts`),
   library, settings. Compute the three aggregates, pass to `InsightsView`.
5. **`InsightsView`** — three sections, dark-theme, matching existing card styles
   (zinc-900 cards, `text-[10px] uppercase` labels, orange accent):
   - **"Where your time goes"**: table of `OpCodePerformance` sorted worst-ratio first,
     showing code, uses, avg flag, avg actual, and a colored ratio chip (reuse
     `efficiencyTier` semantics: ratio ≤ 1.05 good / ≤ 1.25 warn / else bad — note this is
     time-spent÷flag, so LOWER is better; label it "actual vs flag"). Rows with
     `ratio === null` sink to the bottom labeled "never timed". Cap at 15 rows.
   - **"Best days"**: 7 small bars or tiles with weekday efficiency (`fmtPct`), highlight
     best/worst. Skip weekdays with no clocked hours (efficiency null) — render "—".
   - **"Trend"**: last 6 pay periods' efficiency as simple bars (copy the plain-CSS bar
     approach from `HistoryBarChart.tsx` / `AveragesChart.tsx` rather than adding a chart
     library) with period labels.
   - Whole-page empty state via the shared `EmptyState` component when there are no
     entries with actual hours AND no clocks: title "Not enough data yet", guide text
     telling the tech to log clocked hours and use the timer.
6. **Navigation** — `Nav.tsx`: add `{ href: "/insights", label: "Insights" }` to the top
   tabs (desktop). `Header.tsx`: add a lucide icon link (use `Lightbulb` or `TrendingUp`)
   inside the `.header-mobile-only` group next to Pay Period + Settings. Do NOT touch
   `BottomNav.tsx` (see edge case 2).
7. **(Optional — only if `lib/claude.ts` exists)** `actions/insights.ts`:
   auth-gated action that takes the three computed aggregates (NOT raw entries),
   serializes them compactly, and asks `claude-haiku-4-5` (max_tokens 400) for a 3-sentence
   plain-language summary: what's costing money, what's working, one concrete suggestion.
   Render it in an orange-tinted callout at the top with a small "AI summary" label and a
   client "Generate" button (don't call it on page load — it costs money on every visit;
   user-initiated only). Gate rendering on `isClaudeConfigured()`.
8. Verify: `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build`.

## Edge cases a weaker model would miss

1. **Weekday from `"YYYY-MM-DD"` must not use `new Date("2026-07-06")`** — that parses as
   UTC midnight and shifts a day west of Greenwich (Liem is in LA: every date would report
   the previous weekday). Parse manually:
   `const [y,m,d] = date.split("-").map(Number); new Date(y, m-1, d).getDay()`. Check
   whether `lib/periods.ts` already has a local-safe date helper and reuse it.
2. **The mobile bottom bar is capped at 5 items by design** (Dashboard · Log RO · Timer ·
   History · Op Codes). Insights must NOT be added there — mobile access goes through the
   header icon group, the established pattern for Pay Period and Settings.
3. **Pagination exists now**: other pages intentionally load bounded entry sets. Insights
   genuinely needs full history — call `listEntries` with NO limit and add a comment
   saying it's deliberate. If this ever gets slow, the fix is a SQL-side aggregate, not a
   silent limit that quietly skews the stats.
4. **Ratio denominators**: a timed line with `flagHours === 0` (real case: 0.0-flag
   goodwill jobs) would make ratio Infinity — exclude zero-flag lines from ratio math but
   still count them in `uses`.
5. **Lower is better for the actual÷flag ratio** — it's the inverse of the dashboard's
   efficiency coloring. Don't feed it to `efficiencyTier()` directly or the colors invert;
   write a tiny local tier function with the thresholds in step 5.
6. **Custom lines**: group by uppercased `customCode`; lines with `custom: true` and an
   empty code group under their `customDescription`. Never join them to the library by
   `opCodeId` (it's null).
7. **Sub-op-code lines** (`subOpCodeId` set): attribute them to the PARENT library op code
   for grouping (that's how a tech thinks about "brakes"), but use the line's own
   `flagHours` in totals.
8. **`revalidatePath("/insights")`** — existing entry/clock mutations revalidate `/`,
   `/history`, `/pay-period`. Either add `/insights` to those lists in
   `app/actions/entries.ts` + `daily-clock.ts`, or accept stale-until-refresh and say so.
   Adding the revalidate calls is the right move; it's 4 one-line edits.

## Acceptance criteria

- [ ] `/insights` renders for a signed-in user with data: worst op codes ranked with
      sensible ratios, weekday tiles, 6-period trend. No NaN/Infinity anywhere on screen.
- [ ] Fresh account (no data) shows the EmptyState, not a crash or a wall of zeros.
- [ ] Insights tab appears in desktop top nav with correct active state; on mobile
      (<900px) the header icon appears and BottomNav is unchanged (still 5 items).
- [ ] A date like `"2026-07-06"` (a Monday) buckets as Monday in the weekday section
      (verifies edge case 1 — add a unit test pinning this).
- [ ] `insights.test.ts` green with the zero-flag, never-timed, and custom-line cases.
- [ ] Logging a new RO then visiting /insights reflects it (revalidate wiring).
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build` all clean.
