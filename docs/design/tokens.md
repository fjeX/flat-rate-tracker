# Flat Rate Tracker — Design Token Inventory

Source of truth for this doc: `src/app/globals.css` (hand-rolled token system on
top of Tailwind v4, `@import "tailwindcss"`), `src/app/layout.tsx` (font
loading), and a scan of `src/components/**`. All values below are copied
verbatim from source — nothing here is invented or normalized.

Last extracted: 2026-07-06.

---

## 1. Color tokens

All defined in `:root` in `globals.css` (lines 7–51). Dark is the only
implemented theme (`color-scheme: dark`); see §8 for the light-theme gap.

### Backgrounds

| Token | Value | Purpose | Usage notes |
|---|---|---|---|
| `--bg-0` | `#0a0a0c` | Page background (deepest layer) | Used directly in `body`, and re-declared as `--background` for Tailwind's `@theme inline` bridge |
| `--bg-1` | `#111114` | Card gradient bottom stop, collapsed step-card bg | `.card` gradient end, `.step-card.collapsed`, `.input` bg, `.opc-hours-input` bg |
| `--bg-2` | `#16171b` | Card gradient top stop, most "flat" card backgrounds | `.card` gradient start, `.stat`, `.step-card`, `.insight`, `.community`, `.filter-chip`, `.r-tabbar`, `.r-mode-toggle`, `.r-sub-btn` |
| `--bg-3` | `#1d1f24` | Hover/pressed surface, pace track, chip fills | `.btn` default bg, `.pace-track`, `.stat-delta` hover states, `.ro-row:hover`, `.avg-bar` gradient, `.period-bars .bar` gradient, `.r-tab.active` bg, `.r-mode-btn.on` bg |
| `--bg-4` | `#2a2d34` | Hover-on-hover surface, avg-bar gradient top | `.btn:hover`, `.avg-bar`/`.period-bars .bar` gradient top stop, `.r-tab.active`/`.r-mode-btn.on` inset ring color |
| `--line` | `#2c2f36` | Primary hairline border | Card borders, header/tab borders, input borders, dividers |
| `--line-soft` | `#232529` | Secondary/quieter hairline | `.avg-foot` border-top, `.opc-quick` border-top, `.filter-row`/history dashed dividers, `.r-tabbar`/`.r-mode-toggle` border |

### Text

| Token | Value | Purpose | Usage notes |
|---|---|---|---|
| `--fg-0` | `#f5f5f4` | Primary text / highest-emphasis value | Body text color, stat values, headings |
| `--fg-1` | `#d6d3cf` | Secondary text | Descriptions, vehicle lines, `.ro-vehicle`, `.opc-desc` |
| `--fg-2` | `#a3a09a` | Tertiary text / muted labels | Inactive tab text, `.stat .unit`, `.opc-code` description text |
| `--fg-3` | `#6f6c66` | Quaternary / lowest-emphasis text | Section labels, meta text, placeholders, disabled-ish captions (by far the most-used text token) |

### Brand & semantic

| Token | Value | Purpose |
|---|---|---|
| `--brand` | `oklch(0.74 0.165 55)` | Primary brand orange — active states, links, chart highlight |
| `--brand-strong` | `oklch(0.66 0.19 50)` | Darker brand step — gradient bottoms, `.btn-primary` top stop |
| `--brand-soft` | `oklch(0.30 0.10 50 / 0.45)` | Brand-tinted border color |
| `--brand-bg` | `oklch(0.30 0.08 50 / 0.18)` | Brand-tinted fill (chips, badges, active tab bg) |
| `--good` | `oklch(0.78 0.16 150)` | Success/positive semantic (green) |
| `--good-strong` | `oklch(0.65 0.17 150)` | Darker success step (pace-fill gradient) |
| `--good-bg` | `oklch(0.30 0.10 150 / 0.18)` | Success fill |
| `--bad` | `oklch(0.72 0.18 25)` | Error/negative semantic (red) |
| `--bad-bg` | `oklch(0.30 0.12 25 / 0.20)` | Error fill |
| `--warn` | `oklch(0.82 0.15 80)` | Warning semantic (amber/yellow) |
| `--warn-bg` | `oklch(0.30 0.09 80 / 0.20)` | Warning fill |
| `--info` | `oklch(0.75 0.13 230)` | Info semantic (blue) |
| `--info-bg` | `oklch(0.30 0.08 230 / 0.20)` | Info fill |

Note: `--brand` has no `-bg`-only pairing issue, but every semantic pair
(`good/bad/warn/info` + `-bg`) is consistent in shape — each has a solid token
and an `/0.18–0.20` alpha "bg" token. `--brand` is the odd one out with three
steps (`brand`, `brand-strong`, `brand-soft`, `brand-bg`) instead of two.

### Overlay scrim (full-bleed lightbox)

| Token | Value | Purpose |
|---|---|---|
| `--overlay-scrim` | `rgba(0,0,0,0.92)` | Near-black backdrop behind the full-screen photo viewer (`EntryPhotos` PhotoViewer) |
| `--overlay-fg` | `#fff` | Foreground text/icon color on top of that scrim |

Defined in **both** `:root` and `.theme-light` with **identical** values — a
photo lightbox is deliberately dark in either theme, so these are named (not
theme-flipped) to make that intent explicit rather than hardcoding `bg-black/90`
+ `text-white` at the point of use.

### Backwards-compat aliases

```css
--background: #0a0a0c;   /* = --bg-0, only consumed by @theme inline */
--foreground: #f5f5f4;   /* = --fg-0, only consumed by @theme inline */
```
These exist purely to satisfy Tailwind's default `bg-background`/`text-foreground`
utilities via the `@theme inline` block (lines 53–58). No component was found
using `bg-background`/`text-foreground` directly — Tailwind's own `zinc-*`
palette is used instead in several components (see §9).

### One-off colors not tokenized

- `oklch(0.18 0.04 50)` — text color on `.filter-chip.active` (line 872), a
  near-black brand-tinted color for text-on-brand. Not a token; would pair
  naturally with a `--brand-contrast` token.
- `oklch(0.55 0.20 45)` — `.btn-primary` border-color (line 638), a brand step
  darker than `--brand-strong`, not reused elsewhere, not tokenized.
- `oklch(0.85 0.10 60)` — `.stat.featured .stat-label` color (line 283), a
  lighter brand tint, one-off.
- `#fca5a5` / `rgba(153,27,27,0.5)` — hardcoded Tailwind-red-300-ish hex used
  for the delete-RO button in `LogRoForm.tsx` (line 948) instead of `var(--bad)`.

---

## 2. Typography

### Families

| Token | Source | Fallback chain | Usage |
|---|---|---|---|
| `--font-inter` | `Inter` via `next/font/google` (`layout.tsx`) | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | Body default (`body { font-family: var(--font-inter, ...) }`), bridged to Tailwind as `--font-sans` |
| `--font-jetbrains-mono` | `JetBrains_Mono` via `next/font/google`, weights `["400","500","600","700"]` | `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace` | `.mono` utility class, RO numbers, hours values, timer displays — bridged to Tailwind as `--font-mono` |

`.opc-code`/`.pip-time`/etc. re-declare the fallback chain inline
(`var(--font-jetbrains-mono, "JetBrains Mono", monospace)`) rather than using
the `.mono` class — functionally identical but duplicated ~15 times across the
file instead of composed.

### Font sizes actually in use (globals.css)

Every distinct `font-size` value in the file, smallest to largest, with where
it shows up:

| Size | Where |
|---|---|
| `9px` | `.pace-today-label` |
| `10px` | `.opc-code` sub-badges (inline in dropdown), `.optional-badge` |
| `10.5px` | `.app-brand-sub`, `.bottom-tab-label`, `.stat .stat-label`, `.avg-bar-col .day`, `.r-sub-btn`, `.r-footer-cap`, `.field-label`, `.ro-code-chip`, `.pip-status`, `.period-bars-foot` — **the single most common odd size in the file** |
| `11px` | `.section-title`, `.pace-goal`, `.pace-foot`, `.avg-foot`, `.opc-total .label`, `.pip-pace` |
| `11.5px` | `.stat .stat-delta`, `.avg-head .sub`, `.community .sub`, `.scan-banner .sub`, `.pip-context`, `.ro-meta`, `.history-ro-meta`(via component, see §9) |
| `12px` | `.section-title .link`, `.avg-tab`, `.r-readout-label`, `.pace-goal`... (also several), `.r-mode-btn`, `.avg-foot` text, `.period-bars-head .meta` |
| `12.5px` | `.r-tab`, `.filter-chip`, `.btn-sm`, `.empty-state-desc` |
| `13px` | `.avg-head h3`, `.pace-unit`, `.ro-num`, `.opc-code`, `.opc-desc`, `.opc-hours-input`, `.history-summary`, `.opc-line` code |
| `13.5px` | `.app-tab`, `.greeting p`, `.pace-head .title`, `.step-title`, `.scan-banner .label`, `.community .title`, `.history-summary` header, `.history-ro-vehicle` — **second most common odd size** |
| `14px` | `.btn`, `.input`, `.stat .stat-value .unit`, `.insight p`, `.history-ro-num` |
| `15px` | `.app-brand-name`, `.btn-lg` |
| `16px` | `.stat.today-card .stat-value .unit`, `.insight-icon` icon size, `.scan-banner .ico` implicit |
| `17px` | `.greeting h2`, `.greeting .avatar` |
| `22px` | `.pace-now`, `.opc-total .val` |
| `26px` | `.stat .stat-value` (default) |
| `28px` | `.ro-hero .hash` |
| `32px` | `.ro-hero input` |
| `34px` | `.stat.today-card .stat-value`, `.r-readout-value` |
| `38px` | `.pip-time` |

That's **19 distinct sizes** for a system with no defined type scale — there
is no `--text-sm`/`--text-md` token anywhere; every size is a literal px value
written at the point of use.

### Font weights in use

| Weight | Where | Note |
|---|---|---|
| `300` | `.ro-hero .hash` | Only light-weight usage in the file |
| `400` | `.pace-head-meta`, `.pace-unit` | Explicit default, otherwise unspecified elements inherit browser/Tailwind default |
| `500` | `.section-title .link`, `.stat .stat-value .unit` | |
| `550` | `.app-brand-name`, `.app-tab.active`, `.bottom-tab-label`, `.section-title`, `.stat .stat-label`, `.pace-head .title`, `.avg-tab`, `.opc-total .label`, `.field-label`(600 actually, see below), `.btn` | **Non-standard weight** — CSS `font-weight` traditionally steps in 100s; `550` sits between `normal(400)`/`medium(500)` and `semibold(600)` |
| `600` | Widely used: `.greeting h2`, `.avg-head h3`, `.step-title`, `.empty-state-title`, `.ro-num`, `.opc-code`, `.r-tab`, `.field-label`, etc. | Standard weight |
| `650` | `.app-brand-name` (wait — see note), `.stat .stat-value`, `.filter-chip.active` | **Non-standard weight** — a second odd in-between step above 600 and below 700 |
| `700` | `.greeting .avatar`, `.pace-now`, `.ro-row .hours`, `.opc-total .val`, `.history-ro-num`, `.pip-time`, `.r-footer-num` | Standard bold |

`550` and `650` are the two "odd" fractional weights — since `font-weight` is
technically continuous in modern browsers (any integer 1–1000 is valid), these
render fine, but they're bespoke choices with no token backing them, meaning
every future "give this a bit more weight than normal but not full semibold"
decision is a fresh guess rather than a reused value.

---

## 3. Spacing

There is **no spacing token** in `:root` (no `--space-1`, `--gap-sm`, etc.) —
every `padding`/`gap`/`margin` in `globals.css` is a literal px value. Distinct
values seen (deduplicated), grouped by whether they land on a 4px grid:

**On a 4px grid:** `0, 2px, 4px, 6px, 8px, 10px, 12px, 14px, 16px, 18px, 20px, 24px, 28px, 30px, 32px`
— the large majority of layout spacing (card padding, gaps, section margins) follows this cleanly.

**Off the 4px grid (odd/half values):**
| Value | Where |
|---|---|
| `3px` | `.bottom-tab` gap, `.pill` vertical padding, `.stat .stat-value .unit` margin-left, `.r-footer-dot` size, `.opc-code` badge margin |
| `5px` | `.greeting` avatar... no — `.pace .stat-delta` gap, `.opc-chip` gap, `.pip-pace` etc. |
| `7px` | `.bottom-tab` bottom padding (`8px 4px 7px`), `.btn` gap, `.filter-chip` padding |
| `9px` | `.pill` horizontal padding, `.btn-primary`/`pip.collapsed` padding |
| `11px` | `.app-tab` padding, `.input` padding, `.r-mode-btn` padding |
| `13px` | `.community` padding, `.scan-banner` label context (via `13px 14px`) |

Net: spacing is *mostly* disciplined around a 4px rhythm, but roughly a
dozen values (3, 5, 7, 9, 11, 13px) break it — mostly in padding shorthand
where someone hand-tuned a button or chip's vertical rhythm against its
font-size rather than snapping to grid.

---

## 4. Radii

| Token | Value | Usage |
|---|---|---|
| `--radius` | `14px` | Cards (`.card`, `.step-card`, `.insight`, `.community`, `.history-summary`, `.scan-banner`), save-bar (hardcoded `14px` again, not the var — see below), pip (hardcoded `14px`) |
| `--radius-sm` | `10px` | `.stat`, `.opc-dropdown` |

### Hardcoded radii not using a token

| Value | Where |
|---|---|
| `2px` | `.app-tab.active::after`, `.pace-target` |
| `4px` | `.opc-code` badges, `.period-bars .bar` (bottom corners) |
| `4px 4px 2px 2px` | `.period-bars .bar` (asymmetric top/bottom) |
| `6px` | `.avg-bar` (bottom corners), `.opc-line .remove`, `.opc-total`... |
| `6px 6px 3px 3px` | `.avg-bar` (asymmetric top/bottom) |
| `8px` | `.app-tab` (top corners), `.insight-icon`, `.btn-sm` |
| `8px 8px 0 0` | `.app-tab` (asymmetric) |
| `9px` | `.app-brand-mark`, `.community-icon` |
| `10px` | `.btn`, `.input` (both duplicate the `--radius-sm` value as a literal instead of referencing it) |
| `12px` | `.empty-state-icon` |
| `14px` | `.save-bar`, `.pip` (both duplicate `--radius` as a literal) |
| `50%` | Circles: `.app-tab .running-dot`, `.bottom-running-dot`, `.greeting .avatar`, `.step-num`, `.pip.collapsed .dot` |
| `999px` | Pills: `.pill`, `.pace-track`/`.pace-fill`, `.avg-tab`, `.r-tabbar`/`.r-tab`/`.r-mode-toggle`/`.r-mode-btn`/`.r-sub-btn`, `.opc-chip`, `.filter-chip`, `.ro-code-chip`, `.community .badge`, `.pip.collapsed` |

`999px` for "fully pill" is used consistently (good), but `14px` and `10px`
each appear as **both** the token (`var(--radius)`/`var(--radius-sm)`) *and*
a raw literal in different rules — the same value, un-unified.

---

## 5. Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-card` | `0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)` | `.card` — the only shadow token, and the only shadow use that references a variable |

### Hardcoded box-shadows (every other shadow in the file is a one-off)

| Value | Where |
|---|---|
| `inset 0 1px 0 rgba(255,255,255,0.20), 0 6px 16px oklch(0.40 0.16 40 / 0.45)` | `.app-brand-mark` |
| `0 0 18px oklch(0.65 0.18 50 / 0.30)` | `.avg-bar.best` (glow) |
| `inset 0 0 0 1px var(--bg-4)` | `.r-tab.active`, `.r-mode-btn.on` (duplicated identical rule, twice) |
| `0 6px 16px oklch(0.40 0.16 40 / 0.40), inset 0 1px 0 rgba(255,255,255,0.20)` | `.btn-primary` (near-duplicate of `.app-brand-mark`'s shadow, different alpha) |
| `0 0 0 3px oklch(0.66 0.19 50 / 0.18)` | `.input:focus` (focus ring) |
| `0 12px 32px rgba(0,0,0,0.45)` | `.opc-dropdown`, `.save-bar` (identical, reused twice, not tokenized) |
| `0 0 12px oklch(0.65 0.18 50 / 0.40)` | `.period-bars .bar.today` (glow, near-duplicate of avg-bar.best's glow) |
| `0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset` | `.pip` |
| `0 0 0 4px oklch(0.78 0.16 150 / 0.25)` / `0 0 0 4px oklch(0.82 0.15 80 / 0.25)` | `.pip.collapsed .dot` / `.paused .dot` (ring, good/warn variants) |
| `0 0 0 0 oklch(...)` → `0 0 0 6px oklch(... / 0)` | `@keyframes pulse-good` |

Five different shadow "recipes" for translucent black drop shadows
(`rgba(0,0,0,0.35)`, `.45`, `.55`) and three different glow recipes exist with
no shared token — every card/overlay/glow was tuned independently.

---

## 6. Motion

### Durations & easings

| Duration | Easing | Where |
|---|---|---|
| `90ms` | `ease` | `.bottom-tab:active` transform, tactile press-feedback block (`transform 90ms ease`) |
| `120ms` | linear/default | The dominant micro-interaction duration: `.app-tab` color, `.bottom-tab` color, `.card`/`.btn` hover backgrounds, `.avg-bar` background, `.community:hover`, `.ro-row:hover`, filter/avg/r-tab transitions |
| `200ms` | default | `.avg-bar` background transition (chart re-highlight) |
| `280ms` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `.pip` expand/collapse |
| `420ms` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `fade-up` keyframe (stat tile entrance) |
| `460ms` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `bar-rise` on `.period-bars .bar` |
| `520ms` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `bar-rise` on `.r-chart rect` |
| `720ms` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `pace-grow` on `.pace-fill` |
| `1.6s` | `ease-in-out infinite` | `pulse-good` keyframe (running dot) |

The custom ease `cubic-bezier(0.2, 0.8, 0.2, 1)` is reused consistently across
every "entrance" animation (fade-up, bar-rise, pace-grow, pip transition) —
this is the one motion value that **is** disciplined, just never lifted into
a `--ease-*` custom property.

### Keyframes

| Name | Effect |
|---|---|
| `pulse-good` | Box-shadow ring pulse (0 → 6px ring, fades out), 1.6s loop — the "live/running" indicator |
| `fade-up` | Opacity 0→1 + translateY(8px)→0 — stat tile stagger-in |
| `pace-grow` | `width: 0` → natural width — pace bar fill animates in |
| `bar-rise` | `scaleY(0)` → natural, `transform-origin: bottom` — chart bars rise from baseline |

Stagger delays on `.stat-grid .stat:nth-child(n)`: `0ms, 45ms, 90ms, 135ms`
(even 45ms steps — the one place a numeric stagger scale is used).

### Reduced-motion guard

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```
Present at the very bottom of the file (lines 1104–1112). Correctly
`!important`-guarded and blanket-applied (`*`), so it neutralizes both
`transition` and `animation` everywhere, including the Tailwind-class-driven
`animate-ping` used in `TimerView.tsx`'s `StatusBadge` (Tailwind's own
`animate-*` utilities are plain CSS animations, so this guard does cover them).

---

## 7. Gradient inventory

| Gradient | Where | Verdict |
|---|---|---|
| `radial-gradient(ellipse 90% 60% at 50% -10%, oklch(0.30 0.09 50/0.18) 0%, transparent 60%)` + `radial-gradient(ellipse 80% 50% at 100% 100%, oklch(0.25 0.06 230/0.10) 0%, transparent 60%)` over `--bg-0` | `body` background | Subtle — low-alpha ambient glow (brand top-left, info bottom-right), on-tone, sits behind everything. Good use. |
| `linear-gradient(135deg, oklch(0.66 0.19 50), oklch(0.55 0.20 30))` | `.app-brand-mark` (logo tile) | Decorative — full-saturation brand mark, intentionally a "logo chip," appropriate for a one-off brand icon. |
| `linear-gradient(180deg, var(--bg-2), var(--bg-1))` | `.card` (default card surface) | Subtle — the base card treatment, barely-there top-to-bottom shade. On-tone. |
| `linear-gradient(180deg, oklch(0.30 0.10 50/0.18), transparent 60%)` + `linear-gradient(180deg, var(--bg-2), var(--bg-1))` | `.card.brand-tinted` | Subtle — brand wash over the card gradient, low alpha, on-tone. |
| `linear-gradient(135deg, oklch(0.55 0.18 50), oklch(0.45 0.22 30))` | `.greeting .avatar` | Decorative — same "brand chip" treatment as the logo mark, appropriate for an avatar. |
| `linear-gradient(180deg, oklch(0.32 0.10 50/0.18), transparent 100%)` over `var(--bg-2)` | `.stat.featured` | Subtle — featured-tile wash, on-tone, consistent with `.card.brand-tinted`'s approach but a slightly different opacity/stop recipe (near-duplicate, not unified). |
| `linear-gradient(90deg, var(--good-strong), var(--good))` / `.warn` variant / `.bad` variant / `.brand` variant | `.pace-fill` | Subtle — functional progress-bar fill, semantic-colored, on-tone. |
| `linear-gradient(180deg, var(--bg-4), var(--bg-3))` | `.avg-bar`, `.period-bars .bar` (default/non-highlighted bars) | Subtle — neutral bar shading, on-tone. |
| `linear-gradient(180deg, var(--brand), var(--brand-strong))` | `.avg-bar.best`, `.period-bars .bar.today`, `.btn-primary` | Decorative-leaning — full-strength brand gradient used three separate places for "this one is special" (best day / today / primary CTA); consistent recipe, good reuse. |
| `linear-gradient(135deg, oklch(0.30 0.09 80/0.20), transparent 60%)` over `--bg-2` | `.insight` (warning callout) | Subtle — warm/warn wash, on-tone, matches the `.card.brand-tinted` pattern but with warn color instead of brand. |
| `linear-gradient(135deg, oklch(0.30 0.09 50/0.30), transparent 70%)` over `--bg-2` | `.scan-banner` | Subtle — near-identical recipe to `.insight`'s wash and `.card.brand-tinted`, third slightly-different variant of the same idea (60% vs 70% vs 100% stop, 0.18/0.20/0.30 alpha) — this pattern ("diagonal color wash over --bg-2") appears 4 times with 4 different tuned parameters instead of one reusable class/token. |

**Overall verdict:** gradients are tasteful and restrained — nothing garish,
everything either a near-transparent ambient wash or a deliberate "this is
special" brand-chip treatment. The main issue isn't taste, it's duplication:
the "diagonal wash over --bg-2" pattern is hand-tuned four separate times
(`.card.brand-tinted`, `.stat.featured`, `.insight`, `.scan-banner`) with
slightly different angles/stops/alphas that could be one mixin/token.

---

## 8. Findings / inconsistencies

### 1. ~30 components bypass the token system entirely with Tailwind's default palette
A grep for `zinc-|orange-|amber-|green-|red-|slate-|gray-` across
`src/components` matches **29 files** — including entire views like
`TimerView.tsx`, `PayPeriodView.tsx`, `Modal.tsx` (the shared modal shell!),
`GuestTimerView.tsx`, `RoDetailModal.tsx`, and most of `settings/`. These use
raw Tailwind utility classes (`bg-zinc-900`, `border-zinc-800`,
`text-orange-400`, `bg-green-600`, `border-amber-700/60`) instead of the
`--bg-*`/`--fg-*`/`--brand`/semantic tokens or the `.card`/`.btn`/`.input`
classes defined in `globals.css`. Concretely: `TimerView.tsx`'s main timer
card is `rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900
to-zinc-950` — a hand-built card that duplicates `.card` with different
(off-palette) colors, and its Start/Pause buttons are `bg-green-600`/
`bg-orange-600` instead of `.btn`/`.btn-primary` + semantic tokens. This means
the app is visually running two unreconciled color systems at once: the OKLCH
token system (dashboard, log form, header, history) and Tailwind zinc/orange
(timer, pay-period, modals, settings, guest views). A theme change (e.g. the
light theme) will not reach any of these 29 files.

### 2. The `.theme-light` override is incomplete — several tokens have no light variant
`.theme-light` (lines 1083–1099) redeclares `--bg-0..4`, `--line`,
`--line-soft`, `--fg-0..3`, `--brand-bg`, `--background`, `--foreground` — but
**does not** override:
- `--brand`, `--brand-strong`, `--brand-soft` (still the dark-tuned OKLCH values)
- `--good`, `--good-strong`, `--good-bg`
- `--bad`, `--bad-bg`
- `--warn`, `--warn-bg`
- `--info`, `--info-bg`
- `--shadow-card` (tuned for a dark card on a near-black page; on the light
  background this inset highlight/drop shadow combo will look wrong)

Since all the semantic and brand colors were tuned as translucent overlays
against a dark base (e.g. `--good-bg: oklch(0.30 0.10 150 / 0.18)` — a *dark*
0.30-lightness green at 18% alpha, meant to sit on `--bg-2`'s near-black), on
the light background these render as murky/desaturated instead of the crisp
pastel a light theme needs. The light theme is functionally half-built: base
surfaces flip, but every accent, pill, badge, delta, and card shadow stays
dark-mode-tuned.

### 3. Duplicated / near-identical values with no shared token
- Two different `999px`-radius button-hover shadows are hand-copied verbatim:
  `.r-tab.active` and `.r-mode-btn.on` both use
  `inset 0 0 0 1px var(--bg-4)`.
- `.opc-dropdown` and `.save-bar` both use `0 12px 32px rgba(0,0,0,0.45)`
  verbatim but as separate literals, not a shared `--shadow-popover` token.
- The "diagonal brand/semantic wash over `--bg-2`" gradient pattern appears 4
  times (`.card.brand-tinted`, `.stat.featured`, `.insight`, `.scan-banner`)
  with 4 slightly different angle/stop/alpha combinations.
- `14px` and `10px` each exist as both a token (`--radius`, `--radius-sm`) and
  a raw duplicate literal elsewhere in the same file (`.save-bar`, `.pip` use
  literal `14px`; `.btn`, `.input` use literal `10px`).
- The JetBrains Mono fallback chain (`var(--font-jetbrains-mono, "JetBrains
  Mono", ui-monospace, "SF Mono"/monospace)`) is retyped ~15 times instead of
  reusing the existing `.mono` utility class.

### 4. Off-scale, oddly-fractional font sizes with no defined type scale
There is no `--text-*` token anywhere — 19 distinct literal font-size values
exist in `globals.css` alone, several off any conventional scale:
`10.5px` (8 uses — the most common size in the file), `11.5px`, `12.5px`,
`13.5px` (also very common). These read like "the 12px felt slightly small,
bump 1.5px" decisions made independently at each site, not a considered
scale. Two non-standard `font-weight`s compound this: `550` and `650`
(technically valid, since CSS font-weight is a 1–1000 continuum, but neither
is a conventional named weight and both exist purely as "a bit bolder than
the neighbor" one-offs).

### 5. Hardcoded colors that should be semantic tokens
- `LogRoForm.tsx` line 948: the delete-RO button uses
  `color: "#fca5a5", borderColor: "rgba(153,27,27,0.5)"` instead of
  `var(--bad)` / a `--bad`-derived border, for what is clearly a destructive
  action that the token system already has a color for.
- `globals.css` line 872: `.filter-chip.active` uses a bespoke
  `oklch(0.18 0.04 50)` for text-on-brand instead of a `--brand-contrast` (or
  similar) token — meaning any future active-chip-style element has no
  existing token to reach for and will likely invent its own value too.
- `.btn-primary`'s border color (`oklch(0.55 0.20 45)`, line 638) is a brand
  step darker than `--brand-strong` that exists only here.

### Spacing/radius grid notes
Spacing is mostly disciplined to a 4px rhythm, but roughly a dozen padding
values break it (`3px, 5px, 7px, 9px, 11px, 13px`) — concentrated in
button/chip/pill padding where the value was likely tuned against a specific
font-size rather than snapped to the grid. Radii are consistent for "fully
pill" (`999px`, used ~13 times, always literal — never tokenized despite
being reused more than either `--radius` value) and reasonably consistent for
circles (`50%`), but the two named radius tokens (`14px`, `10px`) are each
also duplicated as raw literals elsewhere, so `grep`-ing for "where is
`--radius` used" undercounts actual 14px-radius elements in the app.
