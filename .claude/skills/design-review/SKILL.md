---
name: design-review
description: FRT design quality gate — run before shipping any UI change. Checks new/changed UI against the FRT design system (tokens, type scale, interaction states, accessibility, no-AI-slop rules). Use when Liem says "design review", "polish this screen", "does this look right", or after building any new screen or component.
---

# FRT Design Review

FRT should look and feel like a tool built by people who work on cars — deliberate, dense where it counts, zero template energy. Every UI change passes this gate before it ships.

Adapted from the claude-design-system-prompt review skills (accessibility-audit, ai-slop-check, hierarchy-rhythm-review, interaction-states-pass), tuned to FRT's actual system.

## The FRT system — source of truth

- **Tokens:** `src/app/globals.css` `:root` block. Every color, radius, and shadow comes from a token. No new hex/oklch values without adding a named token first.
- **Token docs:** `docs/design/tokens.md` — read it when adding UI; update it when adding tokens.
- **Type scale:** 11 / 12 / 13 / 14 / 16 / 20 / 26 / 34 px. No half-pixel sizes (13.5, 11.5, 10.5 are legacy — migrate on touch, don't add new ones).
- **Spacing:** multiples of 4px only.
- **Fonts:** IBM Plex Sans for UI (deliberate choice, logged 2026-07-06 — don't swap back to Inter), JetBrains Mono for data. No third font, ever.
- **Numbers are always mono + tabular** (`--font-jetbrains-mono`, `.tabular`). Hours, money, RO numbers, timers — no exceptions. This is the app's signature.
- **Dark is the primary theme.** Light theme (`.theme-light`) must be checked too if the change touches themed surfaces.

## Review checklist — run all four passes

### 1. Interaction states (most common failure)
Every interactive element has: default that *looks* interactive · hover · active/pressed (`scale(0.96)` is the house style) · **`:focus-visible` ring** (2px `var(--brand)`, 2px offset — never bare `outline: none`) · disabled (opacity ~0.55, `cursor: not-allowed`, no hover) · loading for async actions (disable + label swap; server actions must use `useFormStatus` or pending state — no silent double-submits).
Transitions 120–280ms. All motion dies under `prefers-reduced-motion` (guard already exists at the bottom of globals.css — new animations must respect it).

### 2. Accessibility
- Contrast: body text ≥ 4.5:1, large text and UI parts ≥ 3:1. `--fg-3` is decorative-only — never for text that must be read.
- Real elements: `<button>`, `<a href>`, `<label for>`. No clickable divs.
- Every input has a label. Every meaningful icon has an accessible name.
- Hit targets ≥ 44px on mobile — this app is used with greasy thumbs between jobs.
- Color never carries meaning alone (good/warn/bad always pair with text, icon, or position).

### 3. AI-slop check
- No new gradients. The approved set: brand mark, `.btn-primary`, pace fills, chart bars, the body radial wash. Anything else → flat token color.
- No emoji in UI chrome (status dots and real semantic markers are fine).
- No `border-left: 4px` cards. Separation = thin `--line` border or `--bg-*` contrast.
- No invented colors, no off-scale spacing/type values.
- Microcopy sounds like a person: short, concrete, shop-floor plain. Ban: "Oops!", "Something went wrong!", "Supercharge", "seamless", "Let's get started!", exclamation-point enthusiasm. Error messages say what happened and what to do: "Couldn't save — check your connection and hit Save again."

### 4. Hierarchy & rhythm
- Each screen: one obvious primary thing (5-second test). One primary button per view.
- Size/weight/color signals agree — the biggest thing is the most important thing.
- Repeat established patterns (stat tile, card, section-title, pill) before inventing new ones. New pattern = justify it in the PR/commit message.

## How to run it

- **Small change (one component):** walk the four passes inline against the diff.
- **New screen or multi-file change:** spawn parallel review agents (one per pass, Sonnet) per the sub-agent protocol, aggregate, fix blockers and quality issues, then verify rendered output via the dev-server skill.
- Findings rank: blockers (a11y, broken states) → quality (slop, hierarchy) → polish. Fix the first two; list the third.
