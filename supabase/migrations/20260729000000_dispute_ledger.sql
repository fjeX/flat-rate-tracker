-- Dispute Outcome Ledger: what happened AFTER the dispute pack went out.
--
-- Until now FRT could build a claim (src/lib/dispute-pack.ts) and then went
-- blind — the only trace an export ever happened was a localStorage breadcrumb
-- (src/lib/dispute-exports.ts). That means the app could never answer the one
-- question that actually matters to a tech: "did I get paid?"
--
-- This adds the lifecycle: generated -> submitted -> answered -> resolved, plus
-- the recovered hours and dollars. That unlocks the lifetime-recovered figure
-- and, later, outcome coaching ("line-level claims with a photo get paid more
-- often than period-total claims").
--
-- THREE DESIGN RULES, each load-bearing:
--
-- 1. A DISPUTE IS A FROZEN HISTORICAL CLAIM. Every hours/dollars/label field is
--    denormalized and copied in at generation time. It is NOT recomputed from
--    the live ROs, because the ROs move underneath it: reconciling a line sets
--    paid_hours, an RO gets edited, an op code gets renamed, a rate changes. If
--    the claim re-derived itself, then the moment the shop paid you the claim
--    would silently shrink to zero and the record of what you asked for would be
--    destroyed. FK links to entries/lines are kept for navigation only, and both
--    are ON DELETE SET NULL — deleting an RO must never delete the fact that you
--    disputed it.
--
-- 2. RECOVERED MONEY IS A SEPARATE LEDGER. Nothing in here is ever added into
--    period earnings (src/lib/earnings.ts) or into the flagged-vs-paid variance
--    (src/lib/reconcile.ts). Same discipline as unpaid rework being kept out of
--    the variance total: when the shop pays a short, the fix shows up naturally
--    as entry_op_codes.paid_hours going up. Counting it here TOO would
--    double-count the same money.
--
-- 3. BOTH DISPUTE SHAPES ARE FIRST-CLASS. Most techs' pay stubs only show
--    aggregate clocked + flagged hours, not per-RO hours, so they can only ever
--    say "I flagged 88, you paid 84" (scope 'period'). A tech who requests the
--    per-RO hours breakdown from payroll can say exactly which ROs were shorted
--    (scope 'lines'). A ledger that only modeled line-level claims would be
--    unusable for the common case.

-- =========================================================================
-- disputes — one claim raised for one pay period
-- =========================================================================
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- Which pay period the claim is about. Deliberately the period KEY string
  -- ("2026-07-P2"), matching paid_period_hours — periods are a computed concept
  -- (settings.split_day + per-period overrides), not a table.
  period_key text not null,
  -- Human-readable label frozen at generation ("Jul 16 - Jul 31, 2026"). Kept
  -- because a later split_day change would otherwise silently relabel history.
  period_label text not null default '',

  -- 'period' = aggregate claim from a standard pay stub (hours only, no per-RO
  --            detail available).
  -- 'lines'  = itemized claim, one dispute_lines row per shorted RO line.
  scope text not null check (scope in ('period', 'lines')),

  -- generated: pack built/exported, not handed over yet
  -- submitted: given to the service manager / payroll
  -- answered:  they responded — may be a full, partial, or zero adjustment
  -- resolved:  closed out; recovered_* is final
  -- withdrawn: dropped without a resolution (tech's own call)
  status text not null default 'generated' check (
    status in ('generated', 'submitted', 'answered', 'resolved', 'withdrawn')
  ),

  -- What was ASKED for, frozen. See design rule 1.
  claimed_hours numeric(7,2) not null default 0,
  -- null = no labor rate was priced when the claim was raised, so the dollar
  -- value of the claim is genuinely unknown. Never coerce to 0 — "unknown" and
  -- "zero" are different answers and the UI renders them differently.
  claimed_dollars numeric(10,2),

  -- What actually came back. Starts at 0 (asked, nothing recovered yet), not
  -- null — "not yet recovered" and "recovered nothing" are the same number here.
  recovered_hours numeric(7,2) not null default 0 check (recovered_hours >= 0),
  -- Deliberately NOT capped at claimed_hours/claimed_dollars: a shop settling a
  -- dispute sometimes pays more than was claimed (goodwill hours, a rate
  -- correction applied retroactively). Capping would make the ledger lie.
  recovered_dollars numeric(10,2) check (recovered_dollars >= 0),

  -- Lifecycle timestamps. Each is null until that transition happens, so the
  -- ledger records HOW LONG a shop takes to answer — which is itself a signal
  -- worth reporting later.
  generated_at timestamptz not null default now(),
  submitted_at timestamptz,
  answered_at timestamptz,
  resolved_at timestamptz,

  -- Free-text outcome note ("Ray adjusted 3 of the 4 lines, said the alignment
  -- was flagged wrong"). The qualitative half of the outcome.
  note text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Period lookups ("is there already a dispute open for 2026-07-P2?") and the
-- lifetime-recovered rollup both filter on (user, period).
create index if not exists disputes_user_period_idx
  on public.disputes(user_id, period_key);
-- The dashboard aggregate reads every resolved dispute for a user.
create index if not exists disputes_user_status_idx
  on public.disputes(user_id, status);

-- At most ONE live dispute per period. Two open claims for the same period is
-- always a mistake (double-clicked export, or a forgotten earlier draft) and it
-- would double-count the claimed total. Terminal states are excluded, so a tech
-- CAN legitimately raise a second-round dispute after the first is closed.
create unique index if not exists disputes_one_open_per_period_idx
  on public.disputes(user_id, period_key)
  where status not in ('resolved', 'withdrawn');

alter table public.disputes enable row level security;
drop policy if exists "own_disputes" on public.disputes;
create policy "own_disputes" on public.disputes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- dispute_lines — the itemized rows of a scope='lines' claim
-- =========================================================================
-- Every hours field and every label here is a FROZEN COPY (design rule 1). The
-- entry_id / line_id links exist so the UI can jump back to the RO when it still
-- exists; the claim reads correctly even when both are null.
create table if not exists public.dispute_lines (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes on delete cascade,
  -- Denormalized user_id so RLS is a direct column check, matching bonuses and
  -- labor_rates. entry_op_codes goes through an entries join instead, which is
  -- the slower pattern and needs the parent row to still exist — exactly what
  -- this table cannot assume.
  user_id uuid not null references auth.users on delete cascade,

  -- Navigation only. Both SET NULL: deleting the RO must not delete the claim.
  entry_id uuid references public.entries on delete set null,
  line_id uuid references public.entry_op_codes on delete set null,

  -- Frozen identity of the disputed line, so the row still reads as a complete
  -- claim after the RO is edited, relabelled, or deleted outright.
  ro_number text not null default '',
  code text not null default '',
  description text not null default '',
  work_date date,

  flagged_hours numeric(5,2) not null default 0,
  -- What the shop had paid at generation time. null = the line was still pending
  -- (never reconciled) when the claim went out — a legitimate claim shape, and
  -- different from "paid zero".
  paid_hours numeric(5,2),
  -- The ask for this line: flagged − paid, or the full flagged amount when
  -- pending. Stored rather than derived so it survives design rule 1.
  claimed_hours numeric(5,2) not null default 0,
  claimed_dollars numeric(10,2),

  -- Per-line outcome. A shop paying 3 of 4 disputed lines is the normal result,
  -- which is exactly why the period-level total alone is not enough.
  recovered_hours numeric(5,2) not null default 0 check (recovered_hours >= 0),
  recovered_dollars numeric(10,2) check (recovered_dollars >= 0),

  -- Was a photo on file for this RO when the claim went out? Frozen because the
  -- photo can be deleted later. This is the field that answers "do claims with
  -- evidence get paid more often?" — the outcome-coaching payoff.
  had_photo boolean not null default false,

  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispute_lines_dispute_idx
  on public.dispute_lines(dispute_id, position);
create index if not exists dispute_lines_user_idx
  on public.dispute_lines(user_id);

alter table public.dispute_lines enable row level security;
drop policy if exists "own_dispute_lines" on public.dispute_lines;
create policy "own_dispute_lines" on public.dispute_lines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
