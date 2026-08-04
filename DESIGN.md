---
name: Flat Rate Tracker
description: An instrument cluster for a flat rate technician's pay — dense, calm, and legible in a shop bay.
colors:
  bg-0: "#141519"
  bg-1: "#1d1f24"
  bg-2: "#24262c"
  bg-3: "#2d3038"
  bg-4: "#383c45"
  fg-0: "#f4f3f1"
  fg-1: "#d8d5d1"
  fg-2: "#a9a59f"
  fg-3: "#9b9791"
  line: "rgba(255, 255, 255, 0.06)"
  brand: "oklch(0.73 0.14 55)"
  brand-strong: "oklch(0.66 0.16 50)"
  brand-ink: "oklch(0.18 0.04 50)"
  good: "oklch(0.78 0.16 150)"
  warn: "oklch(0.82 0.15 80)"
  bad: "oklch(0.72 0.18 25)"
  info: "oklch(0.75 0.13 230)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.15
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.3
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "26px"
    fontWeight: 700
    fontFeature: "tnum"
rounded:
  sm: "12px"
  md: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.pill}"
    padding: "10px 24px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.pill}"
    padding: "10px 24px"
    height: "44px"
  card:
    backgroundColor: "{colors.bg-1}"
    textColor: "{colors.fg-1}"
    rounded: "{rounded.md}"
    padding: "14px"
  card-inset:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.fg-1}"
    rounded: "{rounded.sm}"
    padding: "14px"
  input:
    backgroundColor: "{colors.bg-0}"
    textColor: "{colors.fg-0}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "44px"
---

# Design System: Flat Rate Tracker

## Overview

**Creative North Star: "The Calm Workspace"**

FRT is an instrument cluster, not a dashboard product. A technician opens it
between jobs, on a phone, with dirty hands, and needs one number in under five
seconds. Every decision serves that moment: the page ground is flat and quiet,
cards float on it by elevation rather than outline, and colour is spent almost
entirely on state rather than decoration. The result should feel like a
well-machined tool — dense where density earns its keep, silent everywhere else.

The palette is a soft warm charcoal ladder rather than the blue-black default of
generated dashboards. Warmth is the tell that a person chose it. Type is IBM Plex
Sans, picked deliberately over Inter because Inter is the single most
recognisable AI-default font tell; JetBrains Mono carries every number. That
split is the system's signature: **prose is set in the sans, and anything you
could add up is set in the mono with tabular figures**, so columns align and
digits stop jittering while a timer runs.

The confirmed anti-reference is generic SaaS template energy: the icon-heading-
paragraph card grid, the eyebrow label above every section, gradient decoration,
and cheerful microcopy. FRT should read as a tool built by someone who works on
cars.

**Key Characteristics:**
- Flat page ground; cards carry all depth via shadow, never a border
- Warm charcoal neutrals, not blue-black
- Colour reserved for state — accent appears on a small fraction of any screen
- Numbers always monospace and tabular
- Pill geometry for anything interactive; generous 18px radius on surfaces
- 44px minimum touch target, everywhere, without exception

## Colors

A warm charcoal ladder carrying a single amber accent, with four semantic states.

### Primary
- **Amber Signal** (`oklch(0.73 0.14 55)`): the one accent. Primary buttons, the
  active pace fill, focus rings, and the brand mark. Its scarcity is what makes
  it readable as "act here".
- **Amber Deep** (`oklch(0.66 0.16 50)`): the pressed and gradient-start partner
  to Amber Signal; also carries small mono emphasis text.

### Secondary
- **Signal Green** (`oklch(0.78 0.16 150)`): on pace, paid, efficiency at or
  above target.
- **Signal Amber-Warn** (`oklch(0.82 0.15 80)`): slipping, short-paid, needs a
  look before payday.
- **Signal Red** (`oklch(0.72 0.18 25)`): behind pace, unpaid, negative variance.
- **Signal Blue** (`oklch(0.75 0.13 230)`): neutral information, never a state
  judgement.

### Tertiary
- **Op-code tag hues** (8 slots, `--tag-hue-0` … `--tag-hue-7`): muted category
  identifiers mapped deterministically from a tag name. They exist only as a 3px
  tick — never as text colour, never as a fill.

### Neutral
- **Bay Black** (`#141519`): the page ground. Flat and quiet; nothing floats here
  except by shadow.
- **Charcoal Surface** (`#1d1f24`): the standard card. The default home for content.
- **Charcoal Inset** (`#24262c`): a panel *within* a card, and the flatten target
  whenever nesting would otherwise occur.
- **Charcoal Raised** (`#2d3038`) / **Charcoal High** (`#383c45`): tracks, rails,
  and unfilled bar backgrounds.
- **Bone** (`#f4f3f1`) → **Ash** (`#9b9791`): the text ramp, brightest for the
  number that matters down to the quietest supporting label.
- **Hairline** (`rgba(255,255,255,0.06)`): used for division *within* a surface.
  It is not how surfaces are separated from each other.

### Named Rules

**The State-Only Colour Rule.** Colour communicates state, never decoration. If a
colour is not answering "is this good, bad, or actionable?", it should be a
neutral. Accent should cover well under 10% of any screen.

**The Ash Floor Rule.** `--fg-3` is the quietest text in the system and now meets
4.5:1 against every background token in both themes. Nothing may be dimmer than
Ash on a readable surface. If text needs to recede further, remove it.

**The Warm Neutral Rule.** Every neutral carries warmth. A pure grey or a
blue-black is off-system and reads as a template default.

## Typography

**Display / Body Font:** IBM Plex Sans (fallback `system-ui, sans-serif`)
**Data / Label Font:** JetBrains Mono (fallback `ui-monospace, monospace`)

**Character:** IBM Plex has engineered, industrial heritage and the best
small-size legibility of the faces evaluated; it pairs naturally with a mono for
data. Together they read as instrumentation rather than marketing. There is no
third family, ever.

### Hierarchy

The scale is closed: **11 / 12 / 13 / 14 / 16 / 20 / 26 / 34 px.** No other size
is legal.

- **Display** (700, 34px, 1.1, -0.02em): page-level hero numbers and landing headlines.
- **Headline** (650, 26px, 1.15): the primary stat in a tile — the number the screen exists to show.
- **Title** (600, 20px, 1.25): section and card headings.
- **Body** (400, 14px, 1.5): prose and descriptions. Target 65–75 characters per line.
- **Secondary body** (400, 13px, 1.45): dense table and list content.
- **Label** (550, 12px, 1.3): field labels, meta rows, timestamps.
- **Micro-label** (550, 11px, ~0.12em tracking, often uppercase): the floor. Tile
  captions and column headers only.

### Named Rules

**The Tabular Numbers Rule.** Every number a technician could add up — hours,
money, RO numbers, percentages, timers — is set in JetBrains Mono with tabular
figures. No exceptions. This is the app's single most recognisable signature.

**The Closed Scale Rule.** Inside the application, 11/12/13/14/16/20/26/34 and
nothing else — no half-pixels, no arbitrary values. Sizes below 11px are never
legal for functional text anywhere, including footers and chart axes, and adding
a smaller step to the scale is not a way to earn one.

**The Display Tier Exception.** The marketing surface (`/`) sits *above* the app
scale and is the only place fluid type is allowed: headlines use `clamp()` with a
mobile floor and a desktop ceiling, because a fixed 34px headline is too small on
a wide screen and too large on a phone. This exception covers `clamp()` display
headings and their body lede only. Every discrete size on that page — labels,
captions, buttons, mock UI — obeys the closed scale like everywhere else.

**The No-Eyebrow Rule.** No kicker or eyebrow label above a heading. The heading
carries its own weight. This also rules out `01 / 02 / 03` section numbering
unless the sequence itself is information the reader needs.

## Layout

A single centred column, max width 1180px, with 28px gutters collapsing to 18px
below 640px. **All spacing is a multiple of 4px.**

Density is deliberate and increases toward data: prose sections breathe, stat
grids are tight. Grids collapse 4→2 columns on tablet and 2→1 on phone; feature
grids collapse 3→2→1. Mobile is the real target, so every layout is designed at
390px first and allowed to relax upward.

Vertical rhythm follows one rule: **more space above a heading than below it**, so
a heading binds to the content it introduces rather than the section it follows.

## Elevation & Depth

The system is **flat-ground, floating-surface**. The page background is
completely flat and carries no shadow, no gradient, and no texture. Cards are
lifted off it by a two-part shadow — a tight contact shadow plus a wide ambient
one — and carry a transparent border so a card never announces itself with an
outline.

This is why nested cards are always wrong: a card inside a card claims a second
elevation that the system has no vocabulary for. Nest with `card-inset` (a darker
tonal panel, no shadow) or with dividers instead.

### Shadow Vocabulary
- **Card** (`0 1px 2px rgba(0,0,0,0.25), 0 10px 30px rgba(0,0,0,0.28)`): every resting surface.
- **Pop** (`0 18px 48px rgba(0,0,0,0.5)`): dropdowns, popovers, sticky save bars — anything genuinely above the page.
- **Focus ring** (`0 0 0 3px oklch(0.73 0.14 55 / 0.3)`): the single source for keyboard focus. Never hand-rolled.

### Named Rules

**The Elevation-Not-Outline Rule.** Surfaces separate by shadow and tonal step,
never by a visible border. A border on a card is a template tell.

**The One Depth Rule.** A surface may be raised once. If content inside a card
needs its own container, it steps *down* tonally (`card-inset`), never up.

## Shapes

Generously rounded and pill-forward. Surfaces use an 18px radius; panels nested
inside them use 12px so the inner corner reads as concentric rather than
competing. Anything interactive — buttons, tabs, chips, status pills — is a full
pill (999px). Inputs are the deliberate exception: they are inset *wells*, darker
than the card they sit on, at 12px, so a field reads as a place to put something
rather than a thing to press.

## Components

### Buttons
- **Shape:** full pill (999px), minimum height 44px.
- **Primary:** Amber Signal fill with Amber Ink text (`brand-ink`, not white — white on amber fails contrast). One primary button per view.
- **Ghost / secondary:** transparent with `fg-2` text, no border at rest.
- **Hover:** brightens one step. **Active:** `scale(0.96)` — the house press.
- **Focus:** the shared 3px focus ring. Never `outline: none` without a replacement.
- **Disabled:** opacity ~0.55, `cursor: not-allowed`, no hover response.
- **Loading:** disabled plus a label swap. Server actions must show pending state — no silent double-submits.

### Cards / Containers
- **Corner:** 18px. **Background:** Charcoal Surface. **Border:** transparent.
- **Shadow:** the Card shadow, always. **Padding:** 14px standard, 16px roomy.
- **Nested content:** `card-inset` at 12px, or dividers. Never a second card.

### Inputs / Fields
- **Style:** inset well — darker than its parent surface, 12px radius, hairline border, 44px minimum height.
- **Focus:** border shifts to Amber Signal plus the shared ring.
- **Every input has a label.** Placeholder text is never the label.

### Navigation
- **Desktop:** pill tabs; the active tab is a *raised surface*, never an underline.
- **Mobile:** bottom tab bar within thumb reach, translucent over a blurred backdrop.

### Stat Tile (signature)
The core instrument. A quiet 11px uppercase mono caption, a large tabular mono
value with a small unit suffix, and an optional coloured delta beneath. One tile
per grid cell may be `featured` — tinted toward the accent — to mark the number
that matters most on that screen.

### Pace Bar (signature)
The other instrument: a rounded track with an amber fill showing progress toward
a pay-period goal, plus a vertical "today" tick marking where the technician
*should* be. A status pill sits alongside. The gap between fill and tick is the
entire point of the component.

## Do's and Don'ts

### Do:
- **Do** put every number in JetBrains Mono with tabular figures.
- **Do** use only 11/12/13/14/16/20/26/34px type and 4px spacing multiples.
- **Do** separate surfaces with elevation and tonal steps, never borders.
- **Do** give every interactive element all five states: default, hover, active (`scale(0.96)`), `:focus-visible`, disabled.
- **Do** keep every touch target ≥44px — this app is used with greasy thumbs.
- **Do** pair colour with text, icon, or position; colour never carries meaning alone.
- **Do** keep transitions between 120–280ms and let all motion die under `prefers-reduced-motion`.
- **Do** reuse an established pattern (stat tile, card, section title, pill) before inventing one; a new pattern must justify itself in the commit message.
- **Do** check the light theme whenever a change touches a themed surface.
- **Do** write microcopy like a person: short, concrete, shop-floor plain. Errors say what happened and what to do — "Couldn't save — check your connection and hit Save again."

### Don't:
- **Don't** add a gradient. The approved set is closed: the brand mark, `.btn-primary`, pace fills, chart bars, and the body radial wash.
- **Don't** put a card inside a card.
- **Don't** add an eyebrow or kicker above a heading, or number sections `01 / 02 / 03`.
- **Don't** use a `border-left: 4px` accent on cards, list items, or callouts.
- **Don't** use a unicode glyph or emoji as an icon — icons are drawn SVG at one consistent stroke weight. (Emoji in UI chrome is banned outright; genuine status dots are fine.)
- **Don't** introduce a raw hex or oklch value. Add a named token first.
- **Don't** use a third font family, and never reinstate Inter.
- **Don't** set functional text below 11px, in any context, including footers.
- **Don't** use `--fg-3` as the only cue for something that must be read at a glance.
- **Don't** ship bounce or elastic easing; motion decelerates, it doesn't overshoot.
- **Don't** write "Oops!", "Something went wrong!", "Supercharge", "seamless", "Let's get started!", or exclamation-point enthusiasm.
- **Don't** put more than one primary button in a view, or more than one obvious primary thing on a screen.
