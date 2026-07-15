# Gamification — Research, Feature Backlog, and Phase 1 Plan

*Created 2026-07-14. Research: deep-research run (24 sources, 25 claims adversarially verified, 22 confirmed). Goal: daily retention that carries techs to the intrinsic payoff — a verifiable work portfolio and real pay insight.*

## Research findings that drive the design

1. **Retention > acquisition.** Duolingo: improving current-user retention had ~5x the DAU impact of any other lever.
2. **Streaks work only with forgiveness.** ~10-day streak → much lower dropout; but rigid streaks cause anxiety/entrapment. Streak freezes reduced churn ~21% for at-risk users. Slack beats rigid rules.
3. **Rewards must be informational, not controlling.** SDT: competence feedback motivates; controlling rewards *reduce* intrinsic motivation (Deci/Koestner/Ryan, 128 experiments).
4. **Pure competition backfires** (anger, anxiety, shop politics). Self-referenced progress or opt-in collaborative goals only.
5. **Mechanic must fit the core loop.** Duolingo's copied-mechanic experiment: zero effect. Every mechanic must map to something a tech already cares about.
6. **Feature overload is real (S-curve).** Ship a small coherent set; too many badges/popups turn motivating into annoying.
7. **Gamification = fading scaffold.** Effect sizes are small (g ≈ 0.26–0.36). Extrinsic hooks early → hand off to intrinsic value (portfolio, pay insight).
8. **Ethics test:** a mechanic is exploitative if it nudges users against their own interest without awareness. **Never reward raw hours volume** (flat-rate equivalent of fitness overtraining injuries) — reward consistency and record quality.

Key sources: Lenny's Newsletter (Duolingo CPO retention writeup), Duolingo streak blog, Sailer & Homner meta-analysis (Educ Psych Review 2020), SDT/gamification meta-analyses, PMC gamified-health-apps review, Kim & Werbach 2016 ethics framework, Frontiers 2025 feature-richness S-curve.

## Phase 1 — APPROVED (2026-07-14)

Liem picked features **1, 2, 8**. Gauge results before adding more.

### 1. Work-day streak with auto-freeze 🔥
Streak counts **days you worked and logged**, not calendar days. Days off / vacation / zero-RO days auto-freeze with no penalty. Highest-evidence mechanic; the freeze is what makes it ethical and sustainable for an irregular work rhythm.

### 2. Career Odometer
Lifetime flagged-hours counter that only climbs, styled like an odometer (the `.rn` rolling-number component already exists). Milestones at 100 / 500 / 1,000 / 5,000 / 10,000 hours. Quietly *is* the portfolio.

### 8. Portfolio Snapshots as unlockables
Every N ROs logged renders an updated, polished portfolio page (jobs documented, hours, specialties, photo count). Makes the far goal visible at RO #50, not year three — the fading scaffold handing motivation to the real thing.

## Backlog — documented for later (numbering from the original list)

- **3. Personal Bests garage 🏆** — PRs vs yourself only: best efficiency week, most hours flagged in a day, best beat-the-book per op-code. Maps onto "I beat book by 2 hours" talk.
- **4. Weekly Dyno Sheet 📊** — auto end-of-week card: flagged vs clocked, efficiency %, best day, biggest job, trend vs last week. Competence feedback, shareable.
- **5. Insight Drops 💡** — occasional unscheduled findings from their own data ("you beat book on brakes 82% of the time"; "diag tickets pay 15% under your average — ~$340 this month"). Variable-reward loop where every hit is real money intel.
- **6. Op-Code Mastery tracks 🔩** — per-op-code progression (log 25 brake jobs → "Brakes: Proven" with avg vs book). Each track is a portfolio line item.
- **7. Pace gauge on dashboard 🏁** — tach-style pay-period gauge with projection ("on pace for 94 hours"). Goal-gradient effect. (Pace ring component partially exists.)
- **9. FRT Wrapped 🎁** — year-end recap: total flagged, efficiency arc, top op-codes, biggest week, earnings story. Identity-building + shareable.
- **10. Crews (opt-in, collaborative only) 🤝** — small groups with a *combined* goal, never a who-flagged-most leaderboard. Ship last, opt-in only.

## Phase 1 edge cases and workarounds (pre-implementation analysis, 2026-07-14)

### Streak
- **"Day off" vs "forgot to log" is indistinguishable without schedule data.** Workaround stack: (1) streak counts **RO dates, not entry timestamps** — logging yesterday's RO tonight repairs yesterday automatically; (2) only *expected* work days can break the streak, inferred from history (a weekday counts as expected only if worked ≥3 of the last 4 same-weekdays); (3) explicit "day off / vacation" toggle in settings for planned absences (freezes indefinitely — covers injury/leave).
- **Zero-flag day at work** (slow day, warranty comebacks): a day with timer activity or a deliberate "worked, nothing to log" check-in freezes rather than breaks.
- **Edits/deletes:** streak is always **derived from RO data at read time**, never stored incrementally — recompute is the source of truth. `Longest streak` is a high-water mark that never decreases.
- **Midnight/timezone:** day boundary = user's local timezone; late-night logging lands on the RO's date anyway per above.

### Career Odometer
- **"Only ever climbs" vs corrections:** total is derived (sum of line flagged hours), so deleting an RO can lower it. Accept small corrections silently (no downward animation); **crossed milestones are earned-once rows and never revoked** by later edits.
- **Pre-FRT career hours:** odometer counts **documented-in-FRT hours only**, labeled "on record" — seeding manual prior hours would poison the verifiable-record claim. (A separate self-reported career-total field can exist later, never merged.)
- **Backfilled ROs crossing a milestone:** milestone detection runs on write; celebrate once (stored row), even if crossed via backfill.
- **Scope:** flagged (line) hours only — bonuses and paid-hour adjustments excluded. Signed-in users only (guest mode has no durable identity).

### Portfolio Snapshots
- **Threshold schedule:** escalating, front-loaded — 10, 25, 50, 100, then every 100. First unlock must arrive in week one for a new user.
- **Immutability:** each snapshot stores its own stats JSON at generation time and is never regenerated — it's a dated record (that's the product). Deleting ROs afterward never revokes an issued snapshot; the *next* unlock threshold just re-computes from current count.
- **Sparse data:** template degrades gracefully — no photos → hide photo stat; no timer usage → hide "avg vs book" (needs clocked hours); <3 op-code tags → skip specialties line.
- **Privacy:** snapshots contain aggregates only — no customer data, VINs, or plates. Photos are counted, never embedded. Sharing/export (PDF) ships default-private.
- **Duplicate unlocks from bulk backfill:** if one save crosses two thresholds, generate both, celebrate only the highest.

### Cross-cutting
- No push-notification channel exists — Phase 1 is **in-app only** (no streak-saver nags; the research says the freeze matters more than the reminder anyway).
- All three are per-user behind RLS like everything else; all derived state must recompute correctly from the ROs table so existing beta users' history counts from day one (instant streak/odometer/snapshot credit on ship = free endowed-progress win).
- Schema sketch: `user_days_off` (date ranges), `milestones` (user, type, threshold, achieved_at), `snapshots` (user, seq, ro_count, stats jsonb, created_at). Streak needs no table.

## Guardrails (apply to everything)

- Never reward hours volume — reward showing up and logging completely.
- Keep the shipped set small (overload S-curve).
- Every mechanic must pass: "does this serve the tech, or just the retention chart?"
