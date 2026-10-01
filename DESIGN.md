---
name: Flat Rate Tracker
description: An instrument cluster for a flat rate technician's pay, mounted in a shop bay. Ruled panels, square-cut controls, two typefaces, one user-chosen accent. Dense, calm, legible at arm's length.
colors:
  # Default theme: dark + blue accent, resolved from the token block at the top
  # of src/app/globals.css. The other themes and accents are in the body
  # (Colors > Themes, Colors > Accents). Every name below is a CSS custom property.
  wall: "#141b1a"
  wall-2: "#0b100f"
  panel: "#1b2423"
  plate: "#0b100f"
  zone-fill: "#212b2a"
  head-tint: "#2a3634"
  ink: "#edf2ee"
  ink-2: "#c0cbc7"
  ink-3: "#9aa8a4"
  disabled-ink: "#9aa8a4"
  line: "#34413f"
  line-soft: "#2c3836"
  edge: "#8b9a96"
  zone-line: "#3e4d4a"
  zone-ink: "#edf2ee"
  block: "#edf2ee"
  block-ink: "#0b100f"
  field: "#0b100f"
  field-line: "#8b9a96"
  quiet-hover: "#2c3836"
  quiet-active: "#34413f"
  bar: "#c0cbc7"
  bar-track: "#2c3836"
  bar-dim: "#6f7f7b"
  trim: "#040706"
  trim-ink: "#edf2ee"
  trim-ink-2: "#a9b7b3"
  trim-line: "#2c3836"
  good: "#7cd591"
  good-ink: "#0b100f"
  good-bg: "#12301e"
  bad: "#fc8e72"
  bad-bg: "#3f1a14"
  note-bg: "#0b100f"
  focus: "#edf2ee"
  focus-on-trim: "#edf2ee"
  select-bg: "#edf2ee"
  select-ink: "#0b100f"
  scroll-thumb: "#6f7f7b"
  backdrop: "rgba(0, 0, 0, 0.7)"
  accent: "#1f6fb5"
  accent-hover: "#185d9a"
  accent-active: "#124c80"
  accent-ink: "#ffffff"
  accent-text: "#8cc3f2"
  accent-tint: "#16324c"
  accent-mark: "#8cc3f2"
  tag-hue-0: "oklch(0.70 0.06 15)"
  tag-hue-1: "oklch(0.72 0.06 60)"
  tag-hue-2: "oklch(0.72 0.05 110)"
  tag-hue-3: "oklch(0.72 0.06 150)"
  tag-hue-4: "oklch(0.72 0.05 200)"
  tag-hue-5: "oklch(0.70 0.06 240)"
  tag-hue-6: "oklch(0.70 0.06 290)"
  tag-hue-7: "oklch(0.70 0.06 330)"
  overlay-scrim: "rgba(0, 0, 0, 0.92)"
  overlay-fg: "#ffffff"
typography:
  # The closed scale. globals.css defines these as rem tokens (--fs-*); the px
  # values below are rem x 16. No other font size is legal in the app.
  scale:
    min: "12px"
    label: "13px"
    body: "15px"
    control: "16px"
    num: "17px"
    title: "19px"
    fig-row: "22px"
    head: "24px"
    head-wide: "28px"
    fig: "28px"
    sign: "44px"
  sign:
    fontFamily: "Azeret Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  fig:
    fontFamily: "Azeret Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "28px"
    fontWeight: 600
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  fig-row:
    fontFamily: "Azeret Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  num:
    fontFamily: "Azeret Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  head:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0"
  title:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "19px"
    fontWeight: 700
  control:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  label:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
    textTransform: "uppercase"
  min:
    fontFamily: "Titillium Web, Segoe UI, Tahoma, sans-serif"
    fontSize: "12px"
    fontWeight: 700
rounded:
  tag: "2px"
  sign: "4px"
  panel: "6px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  gutter: "16px"
  tap: "44px"
  field-h: "48px"
  nav-h: "60px"
  save-h: "54px"
  rail-w: "248px"
  page-max: "1180px"
components:
  button-go:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sign}"
    padding: "0 16px"
    height: "44px"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "0 16px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "0 12px"
    height: "44px"
  zone:
    backgroundColor: "{colors.zone-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 16px 16px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "14px"
  card-inset:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
  headline-panel:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sign}"
    padding: "0 12px"
    height: "48px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "1px 6px 2px"
  modal:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  save-bar:
    backgroundColor: "{colors.wall-2}"
    textColor: "{colors.ink-2}"
    height: "54px"
  bottom-bar:
    backgroundColor: "{colors.trim}"
    textColor: "{colors.trim-ink-2}"
    height: "60px"
---

# Design System: Flat Rate Tracker

Rewritten 2026-10-01 from the built result of the 2026-09 visual overhaul
(rollout phases 1 to 5, all live). Source of truth is the token block at the top
of `src/app/globals.css` and the `src/app/styles/ui-*.css` partials; this file
describes them. If the two disagree, the CSS wins and this file is stale.

## Overview

**Creative North Star: "The Instrument Cluster in the Bay"**

FRT is a gauge panel for a tech's pay, not a dashboard product. It gets opened
between jobs, on a phone, with dirty hands, to read one number in a few
seconds. So the surface looks like painted sheet metal and stamped plates:
ruled panels with square-cut corners, outlined controls, named regions, a
dense but quiet wall. There are no shadows on surfaces, no gradients, no
glass, no glow. Depth comes from tone steps (wall, panel, plate) and from
rules, never from lift.

Two typefaces carry the whole system: **Titillium Web** for every word and
**Azeret Mono** for every figure a tech could add up. Colour is spent on
state only: green means good, a warm red means bad, everything else is
neutral. The one other colour in the app is the user's **accent**, which marks
the brand, the primary action, the current page and the number that matters.

The confirmed anti-reference is generic SaaS template energy, and anything that
looks AI-made: the icon-heading-paragraph card grid, the eyebrow above every
heading, soft glows, cheerful microcopy. The result should read as a tool built
by someone who works on cars, and it must not be dramatic about it.

**Four themes, five accents, saved to the account.** Themes: `dark` (default,
green-grey), `light`, `dark-graphite` (the same depths with no green) and
`dark-pitch` (near black, for OLED phones and dim bays). Accents: `blue`
(default), `orange`, `teal`, `red`, `ink`. The choice lives on `<html>` as
`data-theme` and `data-accent`, is saved to the tech's account
(`user_settings`), and is cached in `localStorage` so a head script can apply
it before first paint (`src/lib/theme.ts`). It is edited in Settings >
Appearance (`ui-appearance.css`: `.opts`, `.opt`, `.swatch`, `.preview`).
Every UI change must hold in all four themes and all five accents.

**Key Characteristics:**
- Ruled panels and 6px radius; controls are 4px, tags 2px. No pill geometry
- No shadows on surfaces. `--lift` exists only for things that pop over the page
- Colour is state only: green good, warm red bad; accent is the brand, never a state
- Figures always Azeret Mono, tabular, tight
- 44px tap floor on everything pressable
- One home per feature, the same class for the same kind of thing on every page

## Colors

Every colour is a semantic token defined once in the token block of
`globals.css`. **No raw colour value appears below that block.** Components
reference tokens only. The frontmatter lists the default (dark + blue) values.

### Surfaces (the wall, the panels, the plates)

| Token | Meaning |
|---|---|
| `--wall` | the page ground; the top bar sits on it |
| `--wall-2` | the deepest ground: `<body>`, dialog title and footer bars, save bar, row buttons |
| `--panel` | a filled surface: `.card`, dialog panel, rail, RO tag |
| `--plate` | a recess cut into a panel: `.card-inset`, the OFF side of a switch, empty-state tile |
| `--zone-fill` | the section panel (`.zone`): one step off the wall so sections read as sections |
| `--head-tint` | the `tint` headline-panel treatment (unused by the default `accent` treatment) |
| `--field` / `--field-line` / `--field-cut` | input fill, its hairline, and the inset cut that makes it a recess |
| `--trim` / `--trim-ink` / `--trim-ink-2` / `--trim-line` | the bottom bar plate and the current-page plate; dark in every theme |
| `--block` / `--block-ink` | neutral inverse block: step numbers, initials (`.who`) |

### Ink and rules

| Token | Meaning |
|---|---|
| `--ink` | the number that matters, headings, control text |
| `--ink-2` | supporting text, labels |
| `--ink-3` | the quietest legal text: meta, asides, placeholder. Never the only cue |
| `--disabled-ink` | text and edge of a disabled control (paired with a dashed outline) |
| `--line` / `--line-soft` | hairlines: row dividers, panel edges, quiet button edges |
| `--edge` | the outline of controls, dialogs, the shell |
| `--zone-line` / `--zone-ink` | the heavy top rule of a `.card` and the tab on it |
| `--bar` / `--bar-track` / `--bar-dim` | chart bars and duration bars, neutral by design |
| `--quiet-hover` / `--quiet-active` | hover and pressed fills for quiet controls |
| `--focus` / `--focus-on-trim` | focus outline, and its colour on the dark trim plate |
| `--select-bg` / `--select-ink`, `--scroll-thumb`, `--backdrop` | text selection, scrollbar thumb, dialog scrim |

### State

| Token | Meaning |
|---|---|
| `--good` / `--good-ink` / `--good-bg` | on pace, paid, saved, a running timer. `--good-ink` is text on a `--good` fill |
| `--bad` / `--bad-bg` | behind, unpaid, lost money, a destructive action. A warm brick, never a cool red |
| `--note-bg` | neutral note field. This is where old "warning" states live now |

### Accents

One token family, defined for light and for all three dark themes, for each of
the five accents (`[data-accent="..."]`; a `[data-swatch="..."]` descendant lets
a swatch carry its own accent):

`--accent` (fill of a primary button, selected chip or segment, switch ON),
`--accent-hover`, `--accent-active`, `--accent-ink` (text on those fills),
`--accent-text` (accent as text or a mark on wall, panel and plate),
`--accent-tint` (the pale field of the headline panel), `--accent-mark` (the
current-page mark on the trim plate).

| Accent | Dark `--accent` | Light `--accent` | Note |
|---|---|---|---|
| `blue` | `#1f6fb5` | `#0a5a9c` | default |
| `orange` | `#f5812f` | `#bf5300` | re-cut to pass AA; dark `--accent-ink` is `#140a02` |
| `teal` | `#0f7f85` | `#00697a` | |
| `red` | `#d1325a` | `#a8163a` | a cool cherry, on purpose, so it never reads as `--bad`; its tint is rose-grey so the headline panel never reads as a warning |
| `ink` | `#edf2ee` | `#14181b` | no hue; for techs who want it plain |

Green and red are state colours and are never offered as accents. There is no
amber or yellow anywhere in the system.

### Headline panel treatments

`<html data-panel="accent|tint|outline">` selects how `.head` is drawn through
the `--head-*` tokens. The app ships `accent` (`layout.tsx` sets
`data-panel="accent"`): `--head-bg` is `--accent-tint`, top rule is `--accent`.
`tint` uses `--head-tint` with an `--ink` rule; `outline` uses `--panel` with a
2px `--ink` outline. `--head-ink`, `--head-ink-2` and `--head-rule` are the
text and divider colours inside it.

### Themes

All four set the same token names; only values change. `light` is a painted
wall (`--wall #e7eae8`) with sign-white panels (`--panel #fcfdfc`); `dark` is
the default listed in the frontmatter; `dark-graphite` and `dark-pitch` share
the dark base and override only surface and ink tokens (graphite
`--wall #181a1d`, pitch `--wall #0b0c0d` with `--wall-2 #000000`). All three
dark themes share the dark accent blocks. Text contrast against every
background token is tested in `src/app/globals-contrast.test.ts`.

### Tag hues and overlay

- **Op-code tag hues** (`--tag-hue-0` to `--tag-hue-7`): eight muted category
  marks, mapped from a tag name by `tagHue.ts`. They exist only as a **3px
  tick** (`.fchip .hue`, the swatch in the op-code form). Never text, never a
  fill. Light and dark each have their own set.
- **`--overlay-scrim` / `--overlay-fg`**: the photo lightbox stays dark in every
  theme, on purpose. They are named so nobody "fixes" the light copy.

### Named Rules

**The State-Only Colour Rule.** Colour answers "is this good or bad?" and
nothing else. Green is good, warm red is bad, everything else is neutral ink or
the user's accent. A "warning" is a neutral NOTE field (`--note-bg`, `--ink-2`),
not a third colour.

**The Accent Is a Mark, Not a State Rule.** The accent colours exactly: the
primary (`go`) button, links and `.zone-link`, the current-page mark, the
logo bars, the ON side of a switch, selected chips and segments, the "today"
bar in a chart, and the accent headline panel. Focus rings stay ink. Figures
and duration bars stay neutral.

**The Ink Floor Rule.** `--ink-3` is the quietest text and must keep AA contrast
against every background token in every theme. Nothing is dimmer. If text needs
to recede further, remove it.

**The Tick Rule.** Category hues are a 3px tick, never text, never a fill.

## Typography

**UI font:** Titillium Web, weights 400 / 600 / 700 (`--font-ui`, fallback
`Segoe UI, Tahoma, sans-serif`).
**Figure font:** Azeret Mono, weights 500 / 600 / 700 (`--font-num`, fallback
`Cascadia Mono, Consolas, monospace`).
Both load through `next/font/google` in `src/app/layout.tsx` and are exposed as
`--font-titillium` and `--font-azeret`. There is no third family, and Inter,
IBM Plex and JetBrains Mono are retired.

**Character:** Titillium is squared, engineered and slightly wide, like stamped
signage. Azeret Mono is wide, so figures are set tight (`--track-num: -0.035em`,
`--track-fig: -0.04em`). Together they read as instrumentation.

### The closed scale

| Token | Size | Used for |
|---|---|---|
| `--fs-min` | 12px | the smallest text anywhere: badges, chart axes, sheet footers |
| `--fs-label` | 13px | labels, asides, `.zone-aside`, small buttons |
| `--fs-body` | 15px | prose, button text, table cells |
| `--fs-control` | 16px | inputs, nav rows, `.btn-lg` (16px stops iOS zooming on focus) |
| `--fs-num` | 17px | figures in rows, `.spec` values, `.num` in tables |
| `--fs-title` | 19px | step and fold titles, row totals, `.gami-sheet-title`, `.head-v .unit` |
| `--fs-head` | 24px | page title on phones (`.pagehead h1`) |
| `--fs-head-wide` | 28px | page title from 700px |
| `--fs-fig` | 28px | figures on the wall, `.head-v.is-2`, chart headline |
| `--fs-fig-row` | 22px | the hours on an RO tag (`.tag-hrs`) |
| `--fs-sign` | 44px | the headline figure (`.head-v`) |

No other size is legal. Below `--fs-min` (12px) nothing functional is set.

### Rules

**The Label Rule.** There is one label style: `--fs-label`, weight 700, uppercase,
`letter-spacing: var(--track-label)` (0.06em). `.field-label`, `.zone-name`,
`.head-k`, `.badge`, `.table th`, `.dlg-head h2` and `.spec dt` share it. A new
label uses it; it does not invent a variant.

**The Figure Rule.** Every number a tech could add up (hours, money, RO numbers,
percentages, timers) is set in `--font-num` with `font-variant-numeric:
tabular-nums`. The shared classes are `.num` (also `.rn`, `.pace-ring-value`),
`.mono` (`font-family: var(--font-num)`) and `.tabular`. Inputs holding figures
use `.input.num` or `.input.mono`. Figures are weight 600.

**The Word-Not-Figure Rule.** Machine identifiers that are not quantities (op
codes) stay in the UI face: `.badge.mono` and `.badge-chip.mono` do not switch to
Azeret. A unit beside a figure is a word, set in the UI face
(`.head-v .unit`, `.spec dd small`, `.tag-hrs .unit`).

**The Decimal Rule.** Figures pull the decimal point and comma in by
`--pt-pull` (-0.14em) each side, through `withPt` / `span.pt`, so a mono
figure does not gap at the point.

**The No-Eyebrow Rule.** No kicker above a heading and no `01 / 02 / 03`
section numbering unless the order is real information. (A step number on Log
RO is a real sequence and is allowed.)

## Layout

Phone first: every layout is designed at 390px and relaxed upward.

- **Spacing** is the `--s1` to `--s7` scale (4, 8, 12, 16, 24, 32, 48px). All
  spacing is a multiple of 4px.
- **Page gutter** is `--gutter`, set on `:root`, and steps with the width: 16px,
  24px from 700px, 32px from 1024px. Pages read `var(--gutter)`; none sets its
  own.
- **Page column** is `--page-max` (1180px), centred, with the page's own
  `*-page` class holding the padding.
- **Zones** (`.zone`) run edge to edge on phones: a full-width band that cancels
  the gutter (`margin: 0 calc(-1 * var(--gutter))`) and keeps content on it. From
  700px they become bounded panels with a hairline edge and `--r-panel`.
  `--zone-pad` is how far a full-bleed child (`.sfield`) bleeds.
- **Shell.** Below 1024px: a sticky top bar (`.topbar`, `z-index: 25`) with the
  logo and a Directory button, and a fixed five-column bottom bar (`.bottomnav`,
  `--nav-h` 60px, `z-index: 30`). From 1024px: a fixed side rail (`.rail`,
  `--rail-w` 248px) replaces both, and `.shell-frame` offsets the content by the
  rail width.
- **Breakpoints in use:** 600px (`.spec` goes 4 across), 640px (dialogs become
  centred), 700px (gutter, zones, save bar un-flush), 900px (legacy `.app-main`
  only) and 1024px (rail, `--hour`, gutter).
- **Tap floor:** `--tap` is 44px. Every pressable is at least that. `--field-h`
  is 48px for inputs and large buttons. A control that looks smaller expands its
  hit area with an invisible `::after`; it never shrinks the target.
- **`--hour`** (52px, 64px from 1024px) is the length of one flagged hour on a
  duration bar (`.dur` is `calc(var(--h) * var(--hour))` wide). A bar's length
  is exact flagged time, one block per hour.
- **Stat grids.** `.spec` is two across on phones (a 2x2 for four figures) and
  `--spec-cols` (default 4) across from 600px. `.head-cells` is two columns.
- **Responsive classes win.** Grid templates are classes (Tailwind or `.spec`),
  never inline `gridTemplateColumns`, which beats the responsive class and caused
  a 127px sideways scroll on the landing page at 390px.
- **Safe areas.** The bottom bar and save bar add `env(safe-area-inset-bottom)`.
  `html { scroll-padding-top: 64px }` below 1024px keeps anchors clear of the
  sticky top bar.

## Elevation & Depth

**The system has no shadows.** Surfaces separate by tone step (wall, panel,
plate), by hairline (`--line`), by a 2px outline (`--edge`) and by the heavy
top rule. `.card`, `.card-inset`, `.empty-state-icon`, `.skel` and the
headline panel all carry `box-shadow: none` or none at all.

The shadow vocabulary is therefore three narrow, functional items:

- **`--lift`** (dark `0 2px 8px rgba(0,0,0,0.6)`, light `0 2px 6px rgba(20,24,27,0.2)`):
  only for things that genuinely pop over the page: the dialog panel
  (`.modal-panel`), dropdown menus (`.log-dd`, `.pp-menu`) and the sticky
  schedule day dock.
- **`--field-cut`** (an `inset` shadow): the cut that makes `.input` and
  `.pill-input` read as a recess in the surface.
- **Inset "underline" marks** (`inset 0 calc(-1 * var(--w-heavy)) 0 var(--ink)`):
  not elevation. They draw the heavy bottom rule on a selected `.switch .off`,
  `.log-toggle` and `.pp-menu-item`.

Nesting is by tone, not by lift: a `.card-inset` (`--plate`, hairline,
`--r-sign`) sits in a panel as a well. A card inside a card is wrong.

### Named Rules

**The No-Shadow Rule.** A card, zone, tile or panel never carries a drop
shadow. If it needs to stand apart, use a tone step, a hairline or a rule.

**The Lift Rule.** `--lift` is for a surface that is above the page in space
(dialog, menu, dock). Nothing at rest uses it.

## Shapes

Square-cut and ruled, like stamped signage. Three radii, all tokens:

- **`--r-panel` (6px):** `.card`, `.zone` (from 700px), `.modal-panel`, `.preview`,
  `.gami-sheet`. A `.card` and the sheet round their **bottom corners only**
  (`0 0 var(--r-panel) var(--r-panel)`): a rounded corner on a 3px top rule
  tapers it to a sliver, so the rule corner stays square.
- **`--r-sign` (4px):** every button, input, select, switch, segment, chip,
  filter chip, icon button, `.card-inset` and `.dlg-close`.
- **`--r-tag` (2px):** `.badge`, `.badge-chip`, `.swatch`.
- **Round:** `border-radius: 50%` only for true circles (the running dot, the
  tag's punched hole, skeleton circles). There is no pill shape.

**Rule weights** (`--w-*`) carry hierarchy in place of shadow:

| Token | Weight | Used for |
|---|---|---|
| `--w-hair` | 1px | dividers, panel edges, input edge |
| `--w-tag` | 1.5px | badge and op-code chip outlines, link underlines |
| `--w-edge` | 2px | control outlines, dialogs, the shell, headline outline |
| `--w-heavy` | 3px | the `.card` top rule, headline top rule, focus outline, selected underline |
| `--w-mark` | 4px | the current-page accent mark |

Legacy leftover: `.pill` in `globals.css` still has `border-radius: 999px`.
New work uses `.badge`; do not extend `.pill`.

## Components

Class names are exact. React wrappers live in `src/components/ui/` (`Button`,
`Card`, `Zone`, `Badge`, `StatusField`, `Field`, `Input`, `Select`, `Switch`,
`Modal`, `Table`, `EmptyState`, `Skeleton`, `DurationBar`, `Figure`,
`RollingNumber`, `ReadoutEfficiency`).

### Buttons (`ui-controls.css`)
- **Base `.btn`:** 44px minimum height and width, `--r-sign`, 2px `--edge`
  outline, transparent fill, weight 700. Hover and press are fills
  (`--quiet-hover`, `--quiet-active`); there is **no press scale**. Focus is a
  3px `--focus` outline offset 2px.
- **`.btn-go` (alias `.btn-primary`):** the one primary action per view.
  `--accent` fill, `--accent-ink` text.
- **`.btn-line` (the default look, also bare `.btn`):** outlined.
- **`.btn-quiet` (alias `.btn-ghost`):** hairline edge, tighter side padding.
  Keeps a visible 44px edge in a row.
- **`.btn-good`:** go-shaped in `--good`, for positive confirmations and the timer start.
- **`.btn-danger`:** line look in `--bad` ink and edge.
- **Sizes:** `.btn-sm` (still 44px), `.btn-lg` and `.btn-field` (48px), `.btn-block` (full width).
- **Disabled** (`:disabled`, `[aria-disabled="true"]`): **dashed outline, flat,
  `--disabled-ink`, never just faded.**
- **Busy** (`[aria-busy="true"]`): solid, `--quiet-active` fill, progress cursor.
  **Saved** (`.is-saved`): `--good` fill; wins over disabled.

### Switch (`.switch`)
Both positions are named: an `OFF | ON` block of two `span`s (`.off`, `.on`).
`[aria-checked="true"]` fills ON with `--accent`; `[aria-checked="false"]` marks
OFF with `--plate` and a heavy ink underline. Disabled is dashed. Use for any
on/off setting.

### Tags and pills (`.badge`, `ui-surfaces.css`)
An **outlined word**: 1.5px `currentColor` outline, `--r-tag`, never filled
(except `.is-selected` / `[data-selected="true"]`, which fill `--accent`). Tones:
`.badge-neutral`, `.badge-good`, `.badge-bad`, `.badge-warn` (neutral `--ink-2`,
not a warning colour), `.badge-brand` / `.badge-info` (`--accent-text`). The
outline and the word carry the colour together. Op-code chip: `.badge-chip`
(and `.ops li`), a quiet `--line` outline, not uppercase; `.badge.mono` for
machine identifiers.

### Zones (`.zone`, `Zone.tsx`)
A bounded, named region: filled `--zone-fill`, name in `.zone-name` (small-caps
label heading) inside `.zone-head`, optional `.zone-aside` (a count) or
`.zone-link` (accent link with a chevron). Edge to edge on phones, a hairline
panel from 700px. **Use for every section of a page.** Cards sit on it.

### Card (`.card`) and wells
`.card` is a filled `--panel` with the **heavy top rule** (`--zone-line`), a
hairline on the other three sides, bottom corners `--r-panel`, no shadow.
Modifiers: `.padded` (14px), `.padded-lg` (16px), `.flush` (clips children),
`.brand-tinted` (`--accent-tint` fill, accent top rule: a callout). A `.zone-name`
as first child hangs from the rule like a tab. `.card-inset` is the recessed
`--plate` well for content inside a panel.

### Headline panel (`.head`)
The "this is the number that matters" component: `.head`, `.head-cells`,
`.head-cell`, `.head-k` (label), `.head-v` (44px figure; `.is-2` for the 28px
second figure; `.unit` for the unit word), `.head-s`, `.head-note`, `.head-row`.
Drawn by the `data-panel` tokens (see Colors). **Use once per page**, for the
figure the page exists to show.

### Stat tiles (`.spec`)
A ruled row of labelled figures, not boxed tiles: `dt`/`.k` is the label, `dd`/`.v`
is the Azeret figure at `--fs-num`, `small` is the unit, `small.sub` a second
line of context ("12% of flagged"). Two across on phones (2x2 for four),
`--spec-cols` across from 600px. **Use for any 2 to 4 related figures.**

### Tagged fields (`.sfield`, `StatusField.tsx`)
A full-width field with a word in a box: `<StatusField tag="Note|Cost|Fix|Saved">`.
`.sfield` + `.sfield-tag` (a `.badge`) + `.sfield-body`; `.is-bad` and `.is-good`
tint the field; `.is-inset` keeps its own padding inside a panel or dialog.
**Note** is neutral (something to know or choose), **Fix** is bad (something is
wrong and the tech can correct it), **Cost** is bad (money lost), **Saved** is
good (a confirmation). The word states the tone, so it never relies on colour
alone. Use `role="alert"` for an error after an action. **This replaces every
banner, toast-style warning and amber callout.**

### Fields (`ui-fields.css`)
`.field` + `.field-label` (the label style) + `.input` (48px, `--field` fill,
1px `--field-line`, `--r-sign`, `--field-cut` inset). Variants: `.input.num` /
`.input.mono` (Azeret), `textarea.input`, `.select-wrap` + `.select` +
`.select-chev`, `.pill-input` (date and time, a field in spite of its name),
`.search-well` (an input with a glyph in its left edge). Messages: `.field-msg`,
`.field-msg-error` (`--bad`, bold). Invalid: `aria-invalid="true"` or
`.field-error` (2px `--bad` edge). Disabled: dashed. Every input has a label;
a placeholder is never the label.

### Chips and segments (`ui-page.css`)
`.fchip` is an outlined toggle chip (`aria-pressed` / `aria-checked` true fills
`--accent`), with an optional `.hue` tick. `.seg` is a segmented control of
`button`s sharing one 2px outline. Use `.seg` for one-of-few views and `.fchip`
for filters.

### Dialogs (`.modal-panel`, `ui-surfaces.css`)
A `--panel` surface with a 2px `--edge` outline and `--lift`. **Phone: a bottom
sheet** (top corners rounded); **from 640px: centred.** Structure: `.dlg-head`
(sticky, `--wall-2` title bar with a bottom rule, `h2` in the label style,
`.dlg-close` the 44px square "x" on the right), `.dlg-body` (16px padding),
`.dlg-foot` (sticky, `--save-h` action bar). `.modal-backdrop` is `--backdrop`.
The close button and actions never scroll away.

### RO tag (`RoTag.tsx`, `.tag`, `ui-page.css`)
One repair order as a luggage tag: clipped corner, a punched hole (`.tag-hole`),
the RO number as the control (`.ro-link`: accent-text, mono, underlined, 44px
target), hours top right (`.tag-hrs`, 22px Azeret), vehicle (`.tag-veh`), meta,
op-code chips (`.ops`), and a `.dur` bar. List them in `.tags`. The RO number is
the only control on the tag. The Recent ROs, Open tickets, History and Pay
Period lists are all made of these.

### Rows
- **`.rowbtn`** in `.rowlist`: a 48px row that opens something. `.rowbtn-aside`
  carries a trailing figure and chevron. `[aria-current]` draws the trim plate
  with an accent mark.
- **`.rows`**: plain ruled rows on the wall, `.k` label and `.v` figure.
- **`.table` / `.tbl`**: ruled rows, 46px, header 30px, figures right-aligned
  via `.table-num`, `.table-foot` closes the ledger with a 2px `--edge` rule,
  `.table-sort` for sortable headers.

### Shell (`ui-shell.css`)
- **Top bar** (`.topbar`, phones, sticky): `.logo` plus `.topbar-actions` of
  `.iconbtn`s, one of which opens the Directory.
- **Directory sheet:** a dialog holding `.dir-list` (48px rows, `.dir-sub` for
  secondary rows) inside `.dir-body`, which runs the rows edge to edge. The same
  `.dir-list` is the side rail's content.
- **Bottom bar** (`.bottomnav`, phones): five `a` cells on the `--trim` plate;
  the current page gets an accent bar (`::before`, `--w-mark`, `--accent-mark`).
  `.run-dot` pulses `--good` when a timer is running.
- **Side rail** (`.rail`, 1024px and up): `--panel`, 2px right `--edge`.
- **Current page, everywhere:** `[aria-current]` is a trim plate carrying an
  accent mark. The same rule in the top bar, bottom bar, rail and `.rowbtn`.
- **Footer** (`.footer`, `.footer-in`, `.footer-link`).
- **Logo** (`.logo`): the tower mark; `.m-block` is `--ink`, `.m-bar` is `--accent-text`.

### Save bar (`.save-bar`)
Slim, 54px (`--save-h`), flush on the bottom bar: sticky above `--nav-h`,
`--wall-2` with a 2px `--edge` top rule, `.summary` text on the left and the
action buttons on the right. From 700px it un-flushes with `--r-sign` top
corners; from 1024px it floats `--s3` above the bottom edge.

### Other
- **Empty state** (`.empty-state`): a `--plate` tile, title, one-line description, an action.
- **Skeleton** (`.skel`): flat `--bar-track`, opacity pulse, off under reduced motion.
- **Bar chart** (`.chart`, `.chart-plot`, `.chart-bars`): plain bars on a ruled
  plot; `.hot` is `--ink`, `.now` ("today") is `--accent-text`, `.zero` and `.dim`
  are `--bar-dim`.
- **Appearance chooser** (`ui-appearance.css`): `.opts`, `.opt`, `.swatch`, `.preview`.
- **Page head** (`.pagehead`, `.who`): the page title at `--fs-head`, and a `.who` initials block.

## Do's and Don'ts

### Do:
- **Do** use only tokens. Colours, sizes, spacing, radii and rule weights all come from the token block. There is no raw colour below it.
- **Do** put every figure in `--font-num` with tabular figures; keep words in `--font-ui`.
- **Do** use only the closed type scale (`--fs-*`) and the `--s*` spacing scale.
- **Do** separate surfaces with tone steps, hairlines and rules, and mark the section with a `.zone`.
- **Do** give every control all five states: default, hover, active, `:focus-visible`, and disabled (dashed).
- **Do** keep every pressable at `--tap` (44px) or more, and expand a small glyph's hit area with `::after`.
- **Do** pair colour with a word, icon or position. Green and red always arrive with text (`Fix`, `Saved`, `Cost`).
- **Do** use the shared class for the shared thing: `.btn-go`, `.badge`, `.sfield`, `.spec`, `.zone`, `.head`, `.tag`, `.rowbtn`, `.seg`, `.fchip`. A new pattern justifies itself in the commit message.
- **Do** check the change in all four themes and at least the blue and orange accents; read `.accent-text` on `--wall`, `--panel`, `--plate` and `--zone-fill`.
- **Do** keep transitions to `--fast` (150ms) with `--ease`, and let motion die under `prefers-reduced-motion`.
- **Do** write microcopy like a person: short, concrete, shop-floor plain. Errors say what happened and what to do.

### Don't:
- **Don't** write a raw colour (hex, rgb, oklch) anywhere below the token block. Add a named token first.
- **Don't** use the retired names: `--bg-*`, `--fg-*`, `--brand`, `--warn`, `--info`, `--radius`, `--shadow-*`. They no longer exist.
- **Don't** add a shadow to a card, zone, tile or panel. `--lift` is for dialogs, menus and docks only.
- **Don't** use amber, yellow or any third state colour. Green is good, warm red is bad, a warning is a neutral `Note`.
- **Don't** use an accent as a state, or put green or red in the accent set.
- **Don't** use a category hue as text or a fill. It is a 3px tick.
- **Don't** make anything round or pill-shaped. Panels are 6px, controls 4px, tags 2px.
- **Don't** use a gradient, glass, blur, glow, or a coloured `border-left` stripe over 1px.
- **Don't** put a card inside a card. Nest with `.card-inset` or a rule.
- **Don't** add an eyebrow above a heading or number sections.
- **Don't** use an emoji or unicode glyph as an icon. Icons are drawn SVG (`svg.ic`, one fill style).
- **Don't** use a third font family, and never reinstate Inter, IBM Plex or JetBrains Mono.
- **Don't** set text below `--fs-min` (12px), and don't add a smaller step.
- **Don't** set `gridTemplateColumns` (or other layout) inline where a responsive class would win. An inline template beats `max-sm:grid-cols-1` and breaks phone width.
- **Don't** fade a disabled control. It is dashed and flat.
- **Don't** use `--ink-3` as the only cue for something that must be read at a glance.
- **Don't** ship bounce or elastic easing.
- **Don't** make it dramatic. No hero metrics with a glow, no celebratory motion, nothing that reads as an AI-generated dashboard template.
- **Don't** write "Oops!", "Something went wrong!", "Supercharge", "seamless", "Let's get started!", or exclamation-point enthusiasm.
- **Don't** put more than one `.btn-go` or more than one `.head` in a view.
