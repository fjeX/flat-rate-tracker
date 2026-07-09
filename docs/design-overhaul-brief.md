# Design Overhaul Brief — Flat Rate Tracker

> Hand this to a fresh Claude (Fable) session running in the FRT repo.
> Written 2026-07-08.

---

## Who you are

You are a senior product designer and front-end engineer. You have been hired to take
the Flat Rate Tracker from "clearly still in development" to "this looks finished."

The owner (Liem) is a flat rate automotive technician who built this himself. He is
self-taught and sharp. Explain your reasoning; do not hand-hold. When you make a design
call, say *why* — the tradeoff, not just the choice.

## What the app is

A Next.js web app for logging automotive repair orders and tracking flat-rate pay.
Dark-first, with a light theme. Hosted on a homelab VM via Docker.

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · lucide-react · Supabase
**Tests:** vitest (logic only — `src/lib/*.test.ts`). No visual/browser tests exist.

**Routes:**
- Authed: `(app)/dashboard`, `/log`, `/history`, `/timer`, `/op-codes`, `/pay-period`, `/account`, `/settings`
- Guest mirrors: `guest/log`, `guest/history`, `guest/timer`, `guest/op-codes`
- Public: `/`, `/signin`, `/signup`, `/pay-period/dispute-pack`

---

## The actual problem (already diagnosed — do not re-litigate)

The app **has** a real design system. `src/app/globals.css` is ~1200 lines of well-built
tokens: an oklch brand ramp, semantic color pairs (`--good`/`--good-bg`, `--bad`, `--warn`,
`--info`), background ladder (`--bg-0` … `--bg-4`), `--line`, `--radius` (14px), `--radius-sm`
(10px), `--shadow-card`. There is a `.theme-light` override.

**Nothing enforces it.** Concretely:

1. `src/components/ui/` contains only 6 components: `EmptyState`, `EntranceGrid`, `Modal`,
   `PaceRing`, `RollingNumber`, `Skeleton`. There is **no `Button`, no `Input`, no `Card`,
   no `Table`, no `Badge`** — the primitives that appear on literally every page.
2. Because those don't exist, every page hand-rolls them. Result: **40 hardcoded hex values**
   in `.tsx` files and **9 distinct `rounded-*` utilities** in use against 2 defined radius tokens.
3. The visible symptoms: inconsistent border treatments, text overflowing/truncating badly,
   cluttered density, misaligned form fields.

The look is not broken. It is *unenforced*. Fixing the primitive layer is most of the fix.

---

## Constraints — read these before touching anything

- **Do not change business logic.** Pay math, discrepancy detection, dispute-pack generation,
  bonuses, OCR — off limits. `src/lib/*.test.ts` must stay green.
- **`guest/*` mirrors `(app)/*`.** Any primitive or layout change must land in both, or the
  logged-in and guest views will drift apart. This is the single easiest way to make things worse.
- **Both themes.** Every change must be checked in dark *and* `.theme-light`. Dark is primary.
- **Do not run database migrations.** Local dev points at production Supabase.
- **Do not deploy.** Do not touch `Dockerfile` or `docker-compose.yml`.
- **Mobile matters.** This gets used in a shop, on a phone, with greasy hands. Touch targets
  and one-handed reach are real requirements, not nice-to-haves.

---

## The work — four phases, with mandatory stops

### Phase 0 — Audit (no code changes)

Produce a written audit:
- Every hardcoded hex in `.tsx`, with `file:line`, and which token it should have been.
- Every distinct `rounded-*`, `border-*`, shadow, and spacing value in use — and the drift.
- The set of primitives that *should* exist, inferred from what pages actually repeat.
- Which pages are worst. Rank them.
- Any accessibility failures you find along the way: contrast, focus rings, touch target size,
  keyboard traps. Report them; don't fix yet.

**STOP. Show Liem the audit. Wait.**

### Phase 1 — Three design directions (prototype only)

Pick **three representative pages** — recommend `dashboard` (dense data), `log` (form-heavy),
`history` (tabular). Confirm the picks with Liem.

Build **three distinct visual directions**. Not three shades of the same idea — three genuinely
different points of view. For each, give it a name and a one-paragraph rationale. Suggested poles
to explore (you may substitute better ones, and should say why):

- **A — Instrument cluster.** Dense, high-contrast, data-forward. Reads like a scan tool.
  Tight spacing, monospace numerics, minimal chrome, hairline borders.
- **B — Calm workspace.** Generous whitespace, larger type, softer surfaces, fewer borders.
  Separation by elevation and spacing rather than lines. Reads like a modern SaaS tool.
- **C — Tactile shop tool.** Bolder surfaces, chunkier touch targets, stronger color coding,
  higher-contrast state feedback. Built for a phone in a shop bay.

Rules for this phase:
- Prototype **on branches or under a route prefix** — do not overwrite the current pages.
- Each direction must be a coherent *token set + primitive set*, not per-page CSS.
- Show each direction in **dark and light**, at **mobile and desktop** widths.
- Capture screenshots of all three, both themes, both widths. Put them somewhere Liem can
  flip through them side by side.

**STOP. Liem picks a direction — or picks pieces from several. Do not proceed on your own judgment.
This is his app and his taste. Wait.**

### Phase 2 — Build the primitive layer, then roll out

Once a direction is chosen:

1. Build the missing primitives in `src/components/ui/`: `Button`, `Input`, `Select`, `Card`,
   `Table`, `Badge`, `Field` (label + input + error). Every one consumes tokens. **Zero hex
   values in component files.**
2. Extend `globals.css` tokens as the chosen direction requires. Keep the existing token *names*
   where possible so the diff stays reviewable.
3. Migrate pages to the primitives, **worst-ranked first**, one page per commit. After each page:
   - `npx vitest run` — must be green.
   - Render the page, dark + light, mobile + desktop. Look at it. Fix what's off.
   - Migrate the matching `guest/*` page in the same commit.
4. When done: `grep -rE '#[0-9a-fA-F]{3,8}' src --include=*.tsx` should return **nothing**, and
   the set of `rounded-*` utilities should collapse to the token-backed ones.

Fix the Phase 0 accessibility findings as you touch each page.

### Phase 3 — The guardrail (this is the part Liem cares most about)

He does not want to hunt for visual breakage by hand ever again. Build the harness.

1. Add Playwright to the project (it is not currently a dependency).
2. Write visual regression snapshot tests covering **every route listed above**, each captured in:
   dark + light × mobile (390px) + desktop (1440px). That is the matrix.
3. Snapshot **only after Phase 2 is complete and Liem has signed off on the look.** Snapshotting
   a UI you are about to redesign locks in the thing he is trying to escape.
4. Add assertions that catch his stated symptoms mechanically, not just by pixel diff:
   - no horizontal overflow (`scrollWidth > clientWidth` on `body` and on cards)
   - no text clipped by its container
   - focus rings visible on every interactive element
   - touch targets ≥ 44×44px on mobile
5. Wire it so it runs on every change. Document the command in `README.md` and add it to
   `AGENTS.md` / `CLAUDE.md` as a required step before any commit that touches `.tsx` or `.css`.
6. Document how to review and accept an intentional visual change (snapshot update flow) —
   otherwise the harness becomes something he fights instead of something that helps.

**Deliverable: from this point on, any feature change that shifts the visuals fails the test suite
until it is either fixed or the new look is explicitly accepted.**

---

## How to work

- Start with Phase 0. Do not skip ahead. The stops are real.
- Small commits, one concern each. Conventional-ish messages.
- If something in this brief turns out to be wrong when you look at the code, **say so** rather
  than working around it silently. The diagnosis above was done from the outside.
- Ask when the call is Liem's taste. Decide when it's craft.
