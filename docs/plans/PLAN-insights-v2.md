# PLAN — Insights v2: measuring what actually moves the paycheck

Status: **steps 1–5 shipped 2026-08-13.** Written after an audit of production
data on 2026-08-13; the numbers below are that audit, not estimates.

---

## Why this plan exists

`/insights` shipped 2026-08-02 answering "which of my jobs run long?". A data
audit showed that question was, for every real user, unanswerable — and that a
better question was sitting in data already collected.

### What the audit found

**Timing coverage across all 7 accounts: 59 measurable lines out of 1,454 (4.1%).**

| Account | lines | measurable | % |
|---|---|---|---|
| `claude@email.com` (the bot's test account) | 343 | **58** | 16.9% |
| Liem | 459 | **1** | 0.2% |
| lopezchristian402 | 534 | **0** | 0.0% |
| everyone else | 118 | 0 | 0.0% |

The bot account also held **27 of 27** comebacks, **6 of 6** disputes and
**88 of 95** `paid_hours` reconciliations. Every per-job insight on the page was
therefore computable only from synthetic data.

**Why real techs don't time jobs.** Not friction — fit. 68% of logged lines flag
under an hour (LOF at 0.31h avg, 10KB at 0.70h), at 5–10 ROs a day. A stopwatch
on a 20-minute oil change eight times a day is an interruption with no payoff.
The timer was designed for 3h+ jobs and is being used exactly that way.

**The finding that settled the design.** Every day quartiled by flag hours, two
techs independently:

| | worst quarter | best quarter |
|---|---|---|
| Liem — flag hours | 4.0 | **19.3** |
| Liem — total lines | 4.8 | 10.6 |
| Liem — **quick lines (≤0.5h)** | 1.8 | **2.5** |
| Liem — heavy lines (≥2h) | 0.2 | **1.4** |
| Christian — flag hours | 6.2 | **15.5** |
| Christian — **quick lines** | 3.3 | **2.9** |
| Christian — heavy lines | 0.1 | **2.1** |

Correlation with a day's flag hours:

| | Liem | Christian |
|---|---|---|
| # heavy lines | **0.572** | **0.704** |
| # quick lines | **0.067** | **−0.027** |

**The number of quick maintenance jobs turned has no relationship to what the
day pays.** Christian's is slightly negative. So perfect measurement of the
grind would describe something that does not move the paycheck — and asking for
it is the behaviour that made the timer feel pointless in the first place.

Caveat, stated on the record: two techs, one shop, ~90 days each. Strong and
replicated, but a hypothesis about this shop, not a law of the trade.

---

## The design rule this produces

> **Job size decides the measurement method, and the measurement method decides
> the insight.**

| | Heavy line (≥2h flag) | Volume maintenance (<2h) |
|---|---|---|
| Share of lines | ~32% | ~68% |
| Share of flag hours | ~64% | ~36% |
| Capture | timer, or ONE coarse retro tap | **nothing — never ask** |
| Insight | per-job ratio vs book | solved-for averages, in aggregate |
| Frequency of ask | ~1×/day | 0 |

---

## What shipped

### 1. Mix — "What makes a big day" (`lib/mix.ts`, `MixSection.tsx`)
Quartile bands + driver correlations. Needs **no timer data at all**, so it pays
off on day one for every user. Guards: 12 days for bands, 10 for correlations;
the "quick jobs don't move your day" claim is gated on the tech's OWN
correlation, so a tech whose data disagrees is never told otherwise.

Validated against production: the TS implementation reproduced the SQL exactly
(4.0 / 9.0 / 12.6 / 19.3 and r = 0.572 / 0.067 / 0.458).

### 2. The relative floor (`lib/insights.ts`)
`MIN_MEASURED_HOURS` (0.1h absolute) missed the worse failure: **0.12h against a
25h engine** cleared it, divided to 0.005, and rendered as **24.9 hours saved —
the #1 row in "Where you're winning."** A ratio of 0.00 looks broken and gets
ignored; 0.005 on a 25h job looks like the best day of a tech's career.

Fix: `minPlausibleActual(flag) = max(0.1, flag × 0.15)`. Production splits
cleanly — junk at 0.005/0.023/0.030/0.085, next genuine reading 0.389, nothing
between. A 5h water pump done in 1.5h (0.30) still passes, because beating the
book is the job. Implausible lines are now **counted and surfaced**, not dropped
silently. One gate, `isMeasuredLine`, shared by every consumer.

### 3. Retro capture (`lib/retro-capture.ts`, `RetroTimePrompt.tsx`)
After saving an RO with a 2h+ untimed line: one row of coarse chips. Never for
the grind. Never before the work. Skip is first-class.

**Required a migration** (`20260813000000_actual_hours_source.sql`) adding
`entry_op_codes.actual_source`. Without it an estimate is indistinguishable from
a clock reading the moment it lands — and `labor_time_observations` feeds a
**shared** pool, where one tech's "call it three hours" corrupts everybody's peer
median and can never be un-mixed. `isPoolableLine` now rejects estimates and
applies the relative floor; `null` source is grandfathered as measured.

Carried through `backup-manifest.ts` and `import-remap.ts` — both compile-time
guards fired during the build and were satisfied, not suppressed.

### 4. Solving for maintenance times (`lib/time-inference.ts`)
`clock hours = overhead + Σ(duration × count)`, ridge-regularised least squares.
Recovers known durations to ±0.05h in tests, plus the daily overhead that never
lands on a ticket.

**It refuses on real data today, and that refusal is the finding.** Against
Christian's 39 clocked days it explained 19% of variance and priced an oil change
at nine minutes, because **a flat-rate tech clocks the same shift whether they
turned four jobs or fourteen** — they absorb the difference in speed, not in
hours. The model assumes the day stretches with the work. It doesn't.

Guards added rather than loosened: minimum day-length variation, minimum R²,
adaptive coefficient budget (days ÷ 3), collinearity detection (10KB and LOF
co-occur on 30 of 37 days — only their *sum* is identifiable), no negative
durations, and folded-out codes are **named**, never silently truncated.

### 5. Big jobs (`insights.bigJobPerformance`, `JobTimeSections.tsx`)
Per-job scorecard scoped to ≥2h lines. Lines filtered **before** grouping, so a
code used both ways never averages a 5h job with a 0.4h one. Coverage meter
always visible. Rows below 3 readings render provisional in muted ink with "N
more to call it" — never a green verdict on one reading.

---

## Deliberately NOT done

- **A forecast/pace block on `/insights`.** `lib/forecast.ts` and `lib/pace.ts`
  already exist and are wired into the dashboard and Pay Period. Per the
  three-way scope rule, a period projection belongs there. A third derivation
  was the original plan and would have been the exact drift this codebase keeps
  getting bitten by.
- **Peer comparison against `labor_time_aggregates`.** 0 observations exist. Not
  a bug — the feature shipped 2026-07-29 and Liem's only measurable line predates
  it (2026-06-17). Gated on timing adoption; it cannot bootstrap itself.
- **Vehicle competence matrix.** `vehicle_make` is on 375/802 entries, but
  `vehicle_mileage` is on **1 of 802** — that axis is unrecoverable.
- **Learning curves / the rush test.** 0 codes reach 8 measurable uses for a real
  user. Both are designed and waiting on data.

---

## Deploy note

`actual_source` writes fail against a database without the migration. The
rebuild skill runs migrate unconditionally before deploy, which is the required
order. Reads are safe either way (`select("*")`).

`database.types.ts` was hand-edited to match what `supabase gen types` will emit;
`scripts/check-types-fresh.mjs` verifies this against the real catalog when the
migration is applied.

---

## What unlocks next

| Needs | Unlocks |
|---|---|
| ~150–200 timed heavy lines | opportunity-ranked leaks, consistency, learning curves |
| comeback→original links on timed jobs | the rush test (do rushed jobs come back?) |
| other techs opted in + timing | peer medians, "is the book wrong or am I slow?" |
| variable clocked-day lengths | the maintenance solve starts returning answers |
