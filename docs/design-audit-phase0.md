# Phase 0 — Design Audit

> Flat Rate Tracker · 2026-07-08 · no code changed.
> Method: full-source sweep of `src/**/*.tsx` + `globals.css` (grep tallies, contrast math, file reads).

---

## 0. The brief's diagnosis, corrected

The brief said the app has tokens but no primitives, so every page hand-rolls. That is
**half right**, and the half that's wrong changes the plan:

| Brief claim | Reality |
|---|---|
| "No Button, no Input, no Card — they don't exist" | They **do** exist — as CSS classes in `globals.css`: `.btn` (+`-primary/-ghost/-sm/-lg/-block`), `.card`, `.input`, `.field-label`, `.filter-chip`, `.pill`, `.stat`. Usage is heavy: `btn` ×183, `input` ×135, `card` ×73. What's missing is *React wrappers* and *enforcement* — nothing stops a page from ignoring them. |
| "40 hardcoded hex values in .tsx" | Exactly 40 — but only ~2 are real offenders (see §1). 23 are the intentionally-monochrome print stylesheet, 4 are the Google logo, 11 are defensive `var(--x, #hex)` fallbacks in error boundaries. |
| "9 distinct rounded-* utilities" | 13 distinct; 10 of them non-token (see §2). Worse than stated. |
| "guest/* mirrors (app)/* — change both" | Partly. `guest/log` and `guest/history` **share** `LogRoForm`/`HistoryView` with the app — they can't drift. The real forks are `GuestTimerView` (431 lines vs `TimerView` 539), `GuestOpCodesView` (245 vs 319), `GuestRoDetailModal` (179 vs 575). Those three pairs are where mirror-drift lives. |

**Revised diagnosis:** the app runs *two parallel styling systems* — a real CSS
component layer (token-clean, consistent) and ad-hoc Tailwind utility clusters
(where all the drift is). The fix is consolidating the second system into the
first and adding enforcement, not building primitives from zero.

---

## 1. Hardcoded hex inventory (40 total)

### Real offenders — live app UI (fix in Phase 2)

| Location | Value | Should be |
|---|---|---|
| `src/components/forms/LogRoForm.tsx:259` | `#fca5a5`, `rgba(153,27,27,0.5)` | `var(--bad)`, `color-mix(in oklab, var(--bad) 50%, transparent)` — the pattern already used in 6 other files |
| `src/components/forms/DuplicateRoDialog.tsx:84` | `oklch(0.18 0.04 50)` inline | needs an "on-brand" token (text color on a brand-filled surface) — same value hardcoded in `app/page.tsx:819` |
| `src/components/forms/ScanRoButton.tsx:272` | `boxShadow: 0 12px 32px rgba(0,0,0,0.45)` | `var(--shadow-card)` or a new `--shadow-pop` token |

### Acceptable as-is (tokenize opportunistically, don't chase)

- `src/app/error.tsx:20–29`, `src/app/(app)/error.tsx:20–27` — `var(--bg-0, #0a0a0c)`-style **fallbacks** for the crash screen (renders even if CSS state is broken). The bare `#fff` on the retry button is the only literal. Defensible.
- `src/components/auth/google-button.tsx:58–70` — Google logo brand colors (`#EA4335` etc.). Must stay per Google brand guidelines.
- `src/components/pay-period/DisputePackPrint.tsx:146–208` — 23 hexes in a **print-only** stylesheet, deliberately black-on-white for paper/PDF handed to a service manager. Screen tokens don't apply. Could get its own `--print-*` tokens, but low value.

**Net: the hex problem is ~3 lines, not 40.** The visible inconsistency comes from §2–§3.

---

## 2. Radius / shadow / type drift (the actual problem)

### Radius — 13 distinct values against 2 tokens

| Utility | px | Count | Verdict |
|---|---|---|---|
| `rounded-md` | 6 | **56** | main offender — 4px off `--radius-sm`, everywhere |
| `rounded-[var(--radius-sm)]` | 10 | 22 | ✅ token |
| `rounded-full` | — | 21 | ✅ legit (pills, dots, avatars) |
| `rounded-lg` | 8 | 4 | drift |
| `rounded-[var(--radius)]` | 14 | 4 | ✅ token |
| `rounded-[9px]` | 9 | 3 | drift (landing page) |
| `rounded-sm`, `rounded-t-sm` | 4 | 3 | drift |
| `rounded-2xl`, `rounded-3xl`, `rounded-xl`, `rounded-tl-lg` | 16–24 | 6 | drift (landing, TimerPip) |

Plus `border-radius: 9px/10px/8px` literals inside `globals.css` component classes
(`.app-brand-mark`, `.btn-sm`, `.app-tab`) — even the CSS layer cheats a little.

The eye reads 4/6/8/9/10/14/16/24px corners on one screen as "unfinished." This is
the single highest-leverage fix: **56 instances of `rounded-md` sitting 4px away
from the token they meant.**

### Shadows — mostly fine

`--shadow-card` exists; drift is small: `shadow-xl/lg/2xl` (one each, Tailwind's
grey defaults — wrong for a dark UI), `ScanRoButton`'s inline rgba above, and a
focus-ring shadow `shadow-[0_0_0_3px_oklch(...)]` repeated **5×** in tsx — that's
the `.input:focus` ring copy-pasted; it should be a `--ring` token.

### Type — a shadow font-scale in arbitrary px

`text-xs`(12)/`text-sm`(14) dominate (309 uses, fine), but alongside:
`text-[10px]` ×30, `text-[11px]` ×29, `text-[12px]` ×19, `text-[13px]` ×9,
`text-[15px]`, `text-[18px]`…`text-[21px]`, one `text-[8px]`. Two type scales
running in parallel — nobody decided what "small label" means, so there are five
of them. Needs 2–3 named steps (e.g. `--text-cap` for the 10/11px uppercase
labels) instead of nine ad-hoc sizes.

### Spacing — healthiest of the lot

Tailwind scale used consistently (`px-3 py-2` etc.). Only oddities: `px-[18px]` ×9,
`p-[18px]` ×2, `pb-[72px]` ×3 (magic number = bottom-nav clearance, duplicating the
`calc(72px + safe-area)` already in `globals.css` — should be one shared value).

---

## 3. Primitives that should exist (inferred from repetition)

Evidence-ranked, biggest payoff first:

1. **`Badge`** — the cluster `rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-2)]` appears **12+ times** with tiny mutations (bg-3/bg-4/brand-bg, fg-2/fg-3, 10px/11px). Textbook missing primitive. Variants: neutral / brand / good / warn / bad.
2. **`Button`** — wrap the existing `.btn` classes in a React component so variant/size become props and a bare `<button className="...">` sticks out in review. Also fixes touch-target sizing in one place (§5).
3. **`Field`** — label + control + error/hint. `.field-label` exists but wiring is manual every time; misalignment between forms is a stated symptom. `LogRoForm`, settings cards, `BonusForm`, `QuickAddModal` all hand-assemble it.
4. **`Select`** — 4 raw `<select>`s (`OpCodeLines`, `PayPeriodView`, `PayRatesCard`, `TimezoneCard`) borrowing `.input`; no chevron treatment, inconsistent height with inputs.
5. **`Table` / `DataList`** — `RoDetailModal` hand-builds a grid table (header row + `w-16/w-20` column widths); history rows exist as one-off `.history-ro-*` CSS; `DisputePackPrint` has its own. Three table systems.
6. **`Card`** — `.card` exists (73 uses) but modals/detail views hand-roll `rounded-md border border-[var(--line)]` boxes instead. A `Card` with `inset`/`section` variants kills most of the 56 `rounded-md`s.

Existing `ui/` components (`Modal`, `EmptyState`, `Skeleton`, `PaceRing`,
`RollingNumber`, `EntranceGrid`) are in good shape — `Modal` in particular has a
real focus trap, Escape handling, and focus restore. Keep them.

---

## 4. Worst pages, ranked

Score = non-token radius + arbitrary-px type + hex per file, weighted by user visibility.

| Rank | Area | Files (drift score) | Why it's ranked here |
|---|---|---|---|
| 1 | **Timer** | `TimerView` (5) + `GuestTimerView` (7) + `TimerPip` (5) + `TimerSaveModal` (3) | Highest combined drift **and** it's a true guest fork — every fix must land twice. `TimerPip` uses `rounded-3xl`/`rounded-tl-lg`, its own visual language. |
| 2 | **RO detail modal** | `RoDetailModal` (12) + `EntryPhotos` (6) + `GuestRoDetailModal` (6) | The face of History. Hand-rolled table, 7× `rounded-md`, badge clusters, 10px header type. Guest fork. |
| 3 | **Pay-period** | `WageCheckCard` (9) + `SpiffsCard` (4) + `ReconciliationCard` (3) + `PeriodStats` (2) + `BonusForm` (5) | Most information-dense screens; mixes token radii and `rounded-md` *within the same card*, which is exactly the "inconsistent borders" symptom. |
| 4 | **Dashboard quick-add** | `QuickAddModal` (11) | 6× `rounded-md` + hand-assembled fields in the app's most-touched flow. |
| 5 | **Settings** | `RoTemplateEditor` (5) + cards (1–2 each) | `rounded-sm`/`lg`/full mix; low blast radius. |
| 6 | **Op-codes** | `OpCodeFormModal` (4), `OpCodeRow` (2), views (1–3) | Actually the *cleanest* feature area — mostly token-correct already. Good reference. |
| — | **Landing page** | `app/page.tsx` (**62** — worst raw score) | Deliberately its own thing (marketing, `rounded-[9px]` device mockups, `text-[8px]` chrome). Decide separately whether it joins the system or stays a one-off. I'd exclude it from Phases 1–2 and revisit after. |

---

## 5. Accessibility findings (report only — no fixes yet)

1. **Touch targets under 44px** — computed from `globals.css`:
   `.btn` ≈ **39px** tall (10px pad + 14px text + border), `.btn-sm` ≈ **30px**,
   `.filter-chip` ≈ **35px**. On a phone with greasy hands these are the primary
   controls. `.bottom-nav` tabs (54px min) and the `.hit-expand` helper show the
   codebase already knows the rule — it's just not applied to buttons. *Fix in Phase 2 via the `Button` primitive.*
2. **10px-and-under text** — `text-[10px]` ×30, `text-[8px]` ×1, mostly uppercase
   metadata labels. At that size, letterform contrast drops below what the ratio math suggests.
3. **Contrast (dark theme, computed):** `--fg-3` on `--bg-0` = 5.46:1 ✅; on
   `--bg-2` = **4.94:1**; on `--bg-3` ≈ 4.6:1 — passes AA 4.5 but with no margin,
   and it's routinely used *at 10px* (points 2+3 compound). `--fg-2` on `--bg-1` = 7.23:1 ✅.
4. **Focus rings — mostly good.** Global `button:focus-visible, a:focus-visible`
   coverage in `globals.css:1057–1072`; `.input:focus` has a visible ring. Gap:
   the ring style is copy-pasted as an arbitrary shadow in 5 tsx files → should be a `--ring` token so it can't drift.
5. **Keyboard traps — none found.** `Modal.tsx` implements a proper trap (Tab cycling, Escape, focus restore, `aria-modal`). Statically clean; worth confirming in-browser during Phase 3.
6. **Not yet audited:** `.theme-light` contrast math (dark was primary per brief) and real-device tap testing. Both belong in the Phase 3 harness as mechanical checks.

---

## 6. What this means for Phase 1

- The token layer is genuinely good — directions should *re-skin the tokens*, not fight them.
- Phase 2 is smaller than the brief assumed on hex (3 lines) and **larger on radius/type** (56 `rounded-md`, two type scales) and on the three guest forks.
- Recommended Phase 1 pages stand: **dashboard** (dense), **log** (form-heavy), **history** (tabular + RO detail modal, rank-2 offender).
