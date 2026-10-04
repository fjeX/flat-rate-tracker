import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  formatPeriodLabel,
  getPeriodForDate,
  isoDate,
  isoDateInTz,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { aggregateStats, aggregateStatsWithSchedule, dailyDenominators, fmtHours } from "@/lib/stats";
import { shiftForDate } from "@/lib/schedule";
import { fmtMoney, hasAnyRate, periodEarnings, ratesToMap } from "@/lib/earnings";
import { computeForecast } from "@/lib/forecast";
import { efficiencyDisplay } from "@/lib/efficiency-display";
import { IMPLAUSIBLE_MULTIPLE } from "@/lib/period-mode";
import { TodayCard } from "@/components/dashboard/TodayCard";
import { FlaggedToDate } from "@/components/dashboard/FlaggedToDate";
import { PaceZone } from "@/components/dashboard/PaceZone";
import { Zone } from "@/components/ui/Zone";
import { StreakCard } from "@/components/dashboard/StreakCard";
import { UnresolvedDaysCard } from "@/components/dashboard/UnresolvedDaysCard";
import { OpenTicketsCard } from "@/components/dashboard/OpenTicketsCard";
import { summarizeOpenTickets } from "@/lib/open-tickets";
import { CareerOdometerCard } from "@/components/dashboard/CareerOdometerCard";
import { SnapshotsCard } from "@/components/dashboard/SnapshotsCard";
import { RecoveredCard } from "@/components/dashboard/RecoveredCard";
import { RecentRos } from "@/components/dashboard/RecentRos";
import { AveragesChart } from "@/components/dashboard/AveragesChart";
import { toJobTimings } from "@/lib/rankings";
import { GuestSyncEffect } from "@/components/guest/GuestSyncEffect";
import { Badge } from "@/components/ui/Badge";
import { SyncedNote } from "@/components/dashboard/SyncedNote";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Number of calendar days between two ISO date strings (inclusive on both ends). */
function daysBetween(start: string, end: string): number {
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** 1-based index of `today` within the period (clamped to [1, periodDays]). */
function dayOfPeriod(periodStart: string, today: string, periodDays: number): number {
  const a = new Date(periodStart + "T00:00:00");
  const b = new Date(today + "T00:00:00");
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 1), periodDays);
}

function formatTodayHeading(today: string): string {
  return new Date(today + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  // When this render's data was read; SyncedNote counts "synced N min ago" from it.
  const fetchedAt = new Date().toISOString();
  const supabase = await createClient();

  // Auth — we need the email for the greeting avatar
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email ?? "";
  const firstName = user?.user_metadata?.first_name as string | undefined;
  const avatarLetter = firstName?.charAt(0).toUpperCase() || email.charAt(0).toUpperCase() || "?";

  // Date ranges
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);
  const settings = await db.getSettings(supabase);
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const weekStart = startOfWeek(today, weekStartDay);
  const weekEnd = endOfWeek(today, weekStartDay);

  // Derived from `today` (already timezone-corrected) rather than by subtracting
  // 90 × 86_400_000 ms from now. Those differ: a fixed 90×24h span crosses a DST
  // boundary an hour short, landing on the previous calendar date twice a year.
  // Calendar arithmetic on the ISO date is what "90 days ago" actually means.
  const ninetyDaysAgo = addDays(today, -90);
  const fetchFrom = [ninetyDaysAgo, monthStart, period.start, weekStart].sort()[0];

  const [entries, clocks, library, laborRates, gamification, schedules, daysOff, confirmedZeroDays, shiftOverrides, unpaidTime, disputeList, openEntries] = await Promise.all([
    db.listEntries(supabase, { from: fetchFrom, to: monthEnd }),
    db.listDailyClocks(supabase, { from: fetchFrom, to: monthEnd }),
    db.listOpCodes(supabase),
    db.listLaborRates(supabase),
    // Streak + odometer + snapshots. Null while the gamification migration
    // hasn't been applied — the cards just don't render.
    db.getGamificationData(supabase, { today }),
    // Null while the work_schedules migration hasn't been applied —
    // efficiency falls back to clocked-hours-only.
    db.listWorkSchedulesSafe(supabase),
    db.listDaysOffSafe(supabase),
    db.listConfirmedZeroDaysSafe(supabase),
    db.listShiftOverridesSafe(supabase),
    // Null until the Phase 2 unpaid-time migration lands — stats then report
    // zero unpaid hours rather than the page failing to render.
    db.listUnpaidTimeSafe(supabase, { from: fetchFrom, to: monthEnd }),
    // Null until the dispute-ledger migration lands — the card hides itself.
    // Not date-filtered: "recovered with FRT" is a lifetime figure.
    db.listDisputesSafe(supabase),
    // Open tickets (status = open), all of them — a ticket opened three weeks
    // ago is exactly the one the card exists to show, so this is not clipped
    // to the 90-day fetch window above. Null until the open-tickets migration
    // lands — the card hides itself.
    db.listOpenEntriesSafe(supabase),
  ]);
  // Their timelines (for the status chip and days-open) and every open_work
  // row on them (for hours-so-far). The ledger read above is date-clipped, so
  // a ticket's hours are read by ticket here rather than trusted to be inside
  // the window.
  const openIds = (openEntries ?? []).map((e) => e.id);
  const [openEvents, openLedger] = await Promise.all([
    openIds.length > 0
      ? db.listRoEventsForEntries(supabase, openIds)
      : Promise.resolve(new Map()),
    openIds.length > 0
      ? Promise.all(openIds.map((id) => db.listUnpaidTimeForEntry(supabase, id))).then((rows) => rows.flat())
      : Promise.resolve([]),
  ]);
  const openTickets = summarizeOpenTickets(openEntries ?? [], openEvents, openLedger, today);
  // Null until the dispute-ledger migration lands — kept as null so the card
  // hides entirely rather than rendering a surface whose links go nowhere.
  const disputes = disputeList;

  // Dollars are additive — computed only when the user has priced a rate.
  const rateMap = ratesToMap(laborRates);
  const showMoney = hasAnyRate(rateMap);
  const periodEntries = entries.filter(
    (e) => e.date >= period.start && e.date <= period.end,
  );
  const periodDollars = showMoney ? periodEarnings(periodEntries, rateMap) : 0;

  // Week/period/month efficiency is schedule-aware once a schedule exists:
  // clocked hours win per day, scheduled hours fill silent days, and today
  // never gets a schedule fallback mid-shift. Today's card stays live off the
  // clocked-hours input, so it uses the plain aggregate.
  const scheduleCtx =
    schedules !== null && schedules.length > 0
      ? {
          schedules,
          daysOff: daysOff ?? [],
          confirmedZeroDays: confirmedZeroDays ?? [],
          today,
          shiftOverrides: shiftOverrides ?? {},
        }
      : null;
  const unpaid = unpaidTime ?? [];
  const rangeStats = (range: { start: string; end: string }) =>
    scheduleCtx
      ? aggregateStatsWithSchedule(entries, clocks, range, scheduleCtx, unpaid)
      : aggregateStats(entries, clocks, range, unpaid);

  const statsToday  = aggregateStats(entries, clocks, { start: today, end: today }, unpaid);
  const statsWeek   = rangeStats({ start: weekStart, end: weekEnd });
  const statsPeriod = rangeStats({ start: period.start, end: period.end });
  const statsMonth  = rangeStats({ start: monthStart, end: monthEnd });

  // Empty scheduled workdays from the trailing 30 days, awaiting a
  // day-off / real-zero decision. Older ones stop nagging (their periods just
  // keep the day held out). Entries/clocks are already fetched 90 days back.
  //
  // `unpaid` is passed so a day with open-ticket hours is resolved (Open
  // Tickets, decision 7) — it must not be asked about.
  const unresolvedDays = scheduleCtx
    ? aggregateStatsWithSchedule(
        entries,
        clocks,
        { start: addDays(today, -30), end: addDays(today, -1) },
        scheduleCtx,
        unpaid,
      ).unresolvedDays
    : [];

  // Day-level efficiency for the Flagged Hours chart's week-tab hover readout.
  const denomByDay = dailyDenominators(
    entries,
    clocks,
    { start: weekStart, end: today },
    today,
    scheduleCtx,
    unpaid,
  );

  const todaysClock  = clocks.find((c) => c.date === today);
  const recentEntries = entries.slice(0, 5);

  // Today's status line — entries are already sorted date desc, created_at
  // desc, so the first match for today's date is the most recently logged one.
  const lastEntryToday = entries.find((e) => e.date === today);
  const todayStatusLine =
    statsToday.roCount > 0
      ? `${statsToday.roCount} RO${statsToday.roCount === 1 ? "" : "s"} logged${
          lastEntryToday ? ` · last one ${timeAgo(lastEntryToday.createdAt)}` : ""
        }`
      : "Nothing logged yet today";

  // ---------------------------------------------------------------------------
  // Pace bar calculations
  // ---------------------------------------------------------------------------
  const goalHours   = settings.goalHours;
  const periodDays  = daysBetween(period.start, period.end);
  const currentDay  = dayOfPeriod(period.start, today, periodDays);
  // Where the "today" tick sits on the bar (0–1)
  const daysLeft     = periodDays - currentDay;
  const paceTarget  = currentDay / periodDays;
  // True fraction of goal (can exceed 1); the track clamps to full,
  // but every NUMBER shown reports the real figure (pace-bar-cap escalation).
  const hasGoal     = goalHours > 0;
  const actualFrac  = hasGoal ? statsPeriod.flagHours / goalHours : 0;

  // Forward projection — where the period lands if recent pace holds. Computed
  // from the entries already loaded above; no extra fetch.
  const forecast = computeForecast(entries, {
    today,
    periodEnd: period.end,
    current: statsPeriod.flagHours,
    goal: goalHours,
    // A day on an open ticket is a worked day for the average and the
    // inferred week (Open Tickets, decision 7).
    unpaid,
  });

  // The pace card prints a forecast built from the RAW flagged total and, four
  // lines below it, an efficiency computed from a per-day-gated numerator those
  // same hours can fall out of. On the first day or two of a period that pairing
  // said "Well ahead — on pace to clear your 45 flag hr goal" directly above
  // "0% efficiency". Both numbers were right; together they were nonsense.
  //
  // The dashboard is the at-a-glance surface, so the fix here is to STOP
  // CONTRADICTING ITSELF, not to grow an explanation: when the percentage would
  // be hollow the foot falls back to `Day N / M`, the substitution this slot has
  // always made when there is no efficiency to state. The forecast line stays —
  // goal progress does not need a measurable day length, so it is still true.
  // The full "these hours aren't in the ratio" account belongs to /pay-period,
  // which owns period detail (memory/feedback_dashboard_stays_lean.md).
  const periodEfficiency = efficiencyDisplay(statsPeriod);

  // The status tag follows the projection, not just the current point.
  // Four states: ahead / near goal (within 10%) / behind / insufficient-history.
  // Tone is state colour only: ahead is green, behind is the warm red, and the
  // two in-betweens are plain tags (Near goal reads NOTE-style, not amber).
  let pillTone: "good" | "warn" | "bad" | "neutral" = "good";
  let pillLabel = "On track";
  if (!hasGoal || forecast.state === "insufficient-history") {
    pillTone = "neutral";
    pillLabel = "Getting started";
  } else if (forecast.state === "ahead") {
    pillTone = "good";
    pillLabel = "On track";
  } else if (forecast.state === "close") {
    pillTone = "warn";
    pillLabel = "Near goal";
  } else {
    pillTone = "bad";
    pillLabel = "Behind";
  }

  // Projection copy — plain language, real status, no filler.
  let forecastLine = "";
  let requiredLine = "";
  if (hasGoal) {
    if (forecast.state === "insufficient-history") {
      forecastLine = "Not enough history yet to project — keep logging and this fills in.";
    } else if (forecast.projected! >= goalHours * IMPLAUSIBLE_MULTIPLE) {
      // Early in a period a strong recent average can extrapolate to an
      // implausible multiple of the goal ("486 of 88"). The math is honest but
      // the number reads broken — report the status, not the wild figure.
      //
      // The multiple is imported, not written here. This file and
      // period-mode.ts each carried their own 1.5 for the identical judgement,
      // on two surfaces a tap apart — the exact shape that drifts (see
      // memory/feedback_duplicate_derivations_drift.md).
      forecastLine = `Well ahead — on pace to clear your ${goalHours} flag hr goal`;
    } else {
      forecastLine = `On pace for about ${Math.round(forecast.projected!)} of ${goalHours} flag hrs`;
      const daysWord = forecast.daysRemaining === 1 ? "day" : "days";
      if (forecast.state === "ahead") {
        requiredLine = "On track to hit your goal — keep it up.";
      } else if (forecast.requiredPerDay !== null && forecast.daysRemaining > 0) {
        requiredLine =
          `Flag about ${fmtHours(forecast.requiredPerDay)} more hrs/day across your ` +
          `${forecast.daysRemaining} working ${daysWord} left to reach ${goalHours}.`;
      } else {
        requiredLine = "No working days left this period.";
      }
    }
  }

  return (
    <main className="dash-page">
      <GuestSyncEffect />

      {/* ── Page head: date, what is logged today, and where the period stands ── */}
      <div className="pagehead">
        <span className="who" aria-hidden="true">
          {avatarLetter}
        </span>
        <div className="grow">
          <h1>{formatTodayHeading(today)}</h1>
          <p>{todayStatusLine}</p>
          <SyncedNote fetchedAt={fetchedAt} />
        </div>
        <Badge tone={pillTone}>{pillLabel}</Badge>
      </div>

      <div className="dash">
        <div>
          {/* ── Today: headline panel, Clocked, Quick Add ─────────── */}
          <TodayCard
            date={today}
            stats={statsToday}
            initialHours={todaysClock?.hours ?? 0}
            library={library}
            todayShift={
              scheduleCtx
                ? shiftForDate(scheduleCtx.schedules, today, scheduleCtx.shiftOverrides)
                : null
            }
            timezone={tz ?? ""}
            trackRoTime={settings.trackRoTime}
          />

          {/* ── Pay period pace ─────────────────────────────────── */}
          <PaceZone
            flagHours={statsPeriod.flagHours}
            goalHours={goalHours}
            hasGoal={hasGoal}
            actualFrac={actualFrac}
            paceTarget={paceTarget}
            daysLeft={daysLeft}
            periodLabel={formatPeriodLabel(period)}
            forecastLine={forecastLine}
            requiredLine={requiredLine}
            dayText={
              periodEfficiency.kind === "shown" ? null : `Day ${currentDay} / ${periodDays}`
            }
          />

          {/* ── Open tickets — absent when there are none ───────── */}
          {/* Above the empty-days zone on purpose: an open ticket is the thing
              most likely to explain a quiet day, and it is the one the tech is
              actively working. */}
          <OpenTicketsCard tickets={openTickets} library={library} rates={rateMap} />

          {/* ── Empty scheduled days needing a decision ─────────── */}
          {unresolvedDays.length > 0 && <UnresolvedDaysCard days={unresolvedDays} />}

          {/* Unpaid time lives on the Pay Period page, not here — the dashboard
              is the at-a-glance surface and this is detail a tech goes looking
              for when checking a period, not something to greet them daily. */}

          {/* ── Flagged to date: week, period, month ────────────── */}
          <FlaggedToDate
            week={statsWeek}
            period={statsPeriod}
            month={statsMonth}
            earnings={showMoney ? fmtMoney(periodDollars) : null}
          >
            {/* Lifetime dispute recovery — its own ledger, never folded into the
                flag-pay numbers above: when a short gets paid it flows through
                as the line's paid hours going up. Renders nothing until there's
                something true to say. */}
            <RecoveredCard disputes={disputes} />
          </FlaggedToDate>

          {/* ── Streak, career odometer, portfolio snapshots ────── */}
          {gamification && (
            <Zone id="z-rec" name="Streak, career, snapshot">
              <div className="recs">
                <StreakCard streak={gamification.streak} />
                <CareerOdometerCard
                  careerTotal={gamification.careerTotal}
                  careerMilestones={gamification.careerMilestones}
                  weekDelta={gamification.weekDelta}
                />
                <SnapshotsCard
                  snapshots={gamification.snapshots}
                  roCount={gamification.roCount}
                  nextSnapshotAt={gamification.nextSnapshotAt}
                  timeZone={tz}
                />
              </div>
            </Zone>
          )}
        </div>

        <div>
          {/* ── Recent ROs ──────────────────────────────────────── */}
          <RecentRos entries={recentEntries} library={library} rates={rateMap} jobTimings={toJobTimings(entries)} />

          {/* ── Flagged hours chart ─────────────────────────────── */}
          <AveragesChart
            entries={entries}
            unpaid={unpaid}
            denomByDay={denomByDay}
            today={today}
            periodStart={period.start}
            periodEnd={period.end}
            weekStart={weekStart}
            weekEnd={weekEnd}
            monthStart={monthStart}
            monthEnd={monthEnd}
            weekStartDay={weekStartDay}
            splitDay={settings.splitDay}
          />
        </div>
      </div>
    </main>
  );
}
