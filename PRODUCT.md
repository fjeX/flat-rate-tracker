# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Flat rate automotive technicians. Primary user is the author (a working flat rate
tech in Los Angeles); the live user base is a small group of techs he knows
personally, at or near his own shop.

The usage scene is the deciding constraint: the app is used **on a phone, in the
bay, between jobs**, often with dirty or gloved hands, under shop lighting, in
short bursts of a few seconds. It is not used at a desk. A tech opens it to log
one repair order and close it, or to check where their pay period stands before
they commit to another job.

Because current users know the author, some workflows can assume a word-of-mouth
explanation. Nothing should *require* one.

## Product Purpose

Flat rate techs are paid on flagged hours, not clocked hours. Shops keep the
authoritative record of what was flagged, and techs generally keep no record of
their own. When flagged time does not appear on a paycheck, the tech has nothing
to push back with.

FRT is the tech's own record. It logs repair orders, tracks flagged versus
clocked hours and efficiency, shows live pace against a pay period goal, and
captures unpaid time (comebacks, waiting) that would otherwise vanish. Success is
a tech catching a shorted check before payday, and — over months — holding a
record of their own performance that no employer controls.

## Positioning

The defensible asset is **the corpus of authentic first-party records logged by
many real technicians.** Not any single feature — the data itself.

This cannot be fabricated, scraped, purchased, or back-filled. A competitor can
copy every screen in a weekend and still have nothing, because what makes the
record valuable is that real techs entered real jobs as they happened. It
compounds: every logged RO makes the pooled dataset more credible, and every
additional tech makes it harder to replicate.

Two surfaces express that asset and reinforce each other:

- **True Time** — pooled real-world labor times: how long jobs actually take
  across many techs, versus book time.
- **Dispute Ledger** — not just what was flagged, but whether it was actually
  paid, and what happened when the tech pushed back.

Pooled times establish what a job really takes; the dispute ledger establishes
what the tech was actually paid for it. Each makes the other more credible, and
both are worthless without genuine first-party entry.

## Operating Context

- **Shop floor, phone-first.** Mobile is the real target, not a fallback.
  Desktop is secondary.
- **Interruption is the norm.** Any flow must survive being abandoned mid-way and
  resumed later.
- **The pay period is the organising unit** of the tech's financial life; pay
  periods form a chain, where adjusting one boundary moves its neighbour's.
- **Adversarial context.** The shop's numbers and the tech's numbers may
  disagree; that disagreement is the product's whole reason to exist. The UI must
  never imply the shop's figure is authoritative.
- Deployed on a self-hosted homelab at `tracker.slimelab.cc`; a managed cloud
  migration is planned.

## Capabilities and Constraints

- RO logging (manual or photo capture), op code library with parent/child codes,
  job timers (up to 3 concurrent), history and charts, pay period view, pay
  reconciliation, insights across periods, schedule, gamification snapshots.
- Guest mode runs entirely in the browser with no account; guest data syncs only
  on an explicit claim action.
- **RO numbers are not unique.** The shop recycles 5-digit RO numbers. RO number
  is a searchable attribute, never an identity. No unique constraints on it.
- **Numbers are the content.** Hours, money, RO numbers and timers are the
  substance of nearly every screen; they are always set in a monospace face with
  tabular figures so columns align and digits do not shift while a timer runs.
- Dark theme is primary; a light theme exists and must stay in parity.
- Derived values have real states. A value that cannot be calculated is not the
  same as a value that is absent — the difference must survive into the UI rather
  than collapsing into "no data".

## Brand Commitments

- **Name:** Flat Rate Tracker (FRT).
- **Voice:** shop-floor plain. Short, concrete, never chirpy. It sounds like a
  tech talking to another tech. Banned: "Oops!", "Something went wrong!",
  "Supercharge", "seamless", "Let's get started!", exclamation-point enthusiasm.
  Errors state what happened and what to do next.
- **Anti-reference:** generic SaaS dashboard energy. FRT should read as a tool
  built by someone who works on cars, not a template with a logo dropped in.
- **Typography is a deliberate, logged decision** (2026-07-06): IBM Plex Sans for
  UI, JetBrains Mono for data. Inter was rejected specifically as the most
  recognisable AI-default font tell. No third family.

## Evidence on Hand

- Real production data from real technicians. **Prod is not a sandbox** — other
  people's pay records live there, and local development points at the production
  database.
- A nightly automated QA bot exercises the full signed-in app and reports by
  email; its run logs are a genuine record of behaviour over time.
- No testimonials, case studies, press, pricing, or customer counts exist. Do not
  invent any. No claim about number of users may be made.

## Product Principles

1. **The tech owns the record.** Portable, employer-proof, and never silently
   altered on their behalf.
2. **Truth over comfort.** Show the real number even when it is bad news; a
   flattering figure that hides a shorted check defeats the entire product.
3. **The bay is the design constraint.** Phone-first, glanceable in seconds,
   usable with dirty hands and interrupted attention.
4. **Every screen earns its density.** This is an instrument cluster, not a
   marketing page — but density must never cost legibility.
5. **One home per feature.** A capability lives on the page that owns it and is
   not mirrored across surfaces.

## Accessibility & Inclusion

- **WCAG AA is the floor and is now met on text colour**: body text ≥ 4.5:1,
  large text and UI parts ≥ 3:1, verified against every background token in both
  themes.
- Touch targets ≥ 44px — the app is operated with gloved and greasy thumbs.
- Colour never carries meaning alone; good/warn/bad always pair with text, icon,
  or position.
- All motion must respect `prefers-reduced-motion`.
- Real semantic elements only: `<button>`, `<a href>`, `<label for>`. No
  clickable divs. Every input has a label; every meaningful icon has an
  accessible name.
