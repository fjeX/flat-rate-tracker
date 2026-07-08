import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import {
  endOfMonth,
  endOfWeek,
  formatPeriodLabel,
  getPeriodForDate,
  isoDate,
  isoDateInTz,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import { aggregateStats, fmtHours, fmtPct } from "@/lib/stats";
import { fmtMoney, hasAnyRate, periodEarnings, ratesToMap } from "@/lib/earnings";
import { computeForecast } from "@/lib/forecast";
import { TodayCard } from "@/components/dashboard/TodayCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { RoList } from "@/components/ro/RoList";
import { AveragesChart } from "@/components/dashboard/AveragesChart";
import { GuestSyncEffect } from "@/components/guest/GuestSyncEffect";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntranceGrid } from "@/components/ui/EntranceGrid";
import { PaceRing } from "@/components/ui/PaceRing";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { ClipboardList } from "lucide-react";

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

  const ninetyDaysAgo = tz
    ? isoDateInTz(tz, new Date(Date.now() - 90 * 86_400_000))
    : isoDate(new Date(Date.now() - 90 * 86_400_000));
  const fetchFrom = [ninetyDaysAgo, monthStart, period.start, weekStart].sort()[0];

  const [entries, clocks, library, laborRates] = await Promise.all([
    db.listEntries(supabase, { from: fetchFrom, to: monthEnd }),
    db.listDailyClocks(supabase, { from: fetchFrom, to: monthEnd }),
    db.listOpCodes(supabase),
    db.listLaborRates(supabase),
  ]);

  // Dollars are additive — computed only when the user has priced a rate.
  const rateMap = ratesToMap(laborRates);
  const showMoney = hasAnyRate(rateMap);
  const periodEntries = entries.filter(
    (e) => e.date >= period.start && e.date <= period.end,
  );
  const periodDollars = showMoney ? periodEarnings(periodEntries, rateMap) : 0;

  const statsToday  = aggregateStats(entries, clocks, { start: today, end: today });
  const statsWeek   = aggregateStats(entries, clocks, { start: weekStart, end: weekEnd });
  const statsPeriod = aggregateStats(entries, clocks, { start: period.start, end: period.end });
  const statsMonth  = aggregateStats(entries, clocks, { start: monthStart, end: monthEnd });

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
  // How full the progress fill is (0–1, clamped to 1 for display)
  const hasGoal     = goalHours > 0;
  const actualFill  = hasGoal ? Math.min(statsPeriod.flagHours / goalHours, 1) : 0;

  // Forward projection — where the period lands if recent pace holds. Computed
  // from the entries already loaded above; no extra fetch.
  const forecast = computeForecast(entries, {
    today,
    periodEnd: period.end,
    current: statsPeriod.flagHours,
    goal: goalHours,
  });

  // Pill + ring colour follow the projection, not just the current point.
  // Four states: ahead / close (within 10%) / behind / insufficient-history.
  let pillClass = "";
  let pillLabel = "On track";
  let ringTier: "good" | "warn" | "bad" | null = null;
  if (!hasGoal || forecast.state === "insufficient-history") {
    pillClass = "neutral";
    pillLabel = "Getting started";
    ringTier = null;
  } else if (forecast.state === "ahead") {
    pillClass = "";      // default pill = good
    pillLabel = "On track";
    ringTier = "good";
  } else if (forecast.state === "close") {
    pillClass = "warn";
    pillLabel = "Close";
    ringTier = "warn";
  } else {
    pillClass = "bad";
    pillLabel = "Behind";
    ringTier = "bad";
  }

  // Projection copy — plain language, real status, no filler.
  let forecastLine = "";
  let requiredLine = "";
  if (hasGoal) {
    if (forecast.state === "insufficient-history") {
      forecastLine = "Not enough history yet to project — keep logging and this fills in.";
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

  // pace-fill colour: brand for normal progress
  const paceFillClass = `pace-fill brand`;

  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <GuestSyncEffect />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Greeting + Pace card ────────────────────────────── */}
        <div className="card flush">
          <div className="greeting">
            <div className="avatar">{avatarLetter}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>{formatTodayHeading(today)}</h1>
              <p>{todayStatusLine}</p>
            </div>
            <span className={`pill${pillClass ? " " + pillClass : ""}`}>
              {pillLabel}
            </span>
          </div>
          <div style={{ height: 1, background: "var(--line)", margin: "0 16px" }} />
          <EntranceGrid className="pace" animationName="pace-grow">
            <div className="pace-head">
              <span className="title">
                Pay Period Pace
                <span className="pace-head-meta"> · {daysLeft} {daysLeft === 1 ? "day" : "days"} left</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <PaceRing
                value={actualFill}
                size={64}
                tier={ringTier}
                label={`${Math.round(actualFill * 100)}%`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pace-values">
                  <span className="pace-now">
                    <RollingNumber value={statsPeriod.flagHours} decimals={1} /><span className="pace-unit"> flag hrs</span>
                  </span>
                  <span className="pace-goal">Goal {goalHours}</span>
                </div>
                <div className="pace-track-wrap">
                  <span className="pace-today-label" style={{ left: `${paceTarget * 100}%` }}>TODAY</span>
                  <div className="pace-track">
                    <div
                      className={paceFillClass}
                      style={{ width: `${actualFill * 100}%` }}
                    />
                  </div>
                  <div
                    className="pace-target"
                    style={{ left: `${paceTarget * 100}%` }}
                  />
                </div>
              </div>
            </div>
            {hasGoal && (
              <div className="pace-forecast">
                <div className="pace-forecast-proj">{forecastLine}</div>
                {requiredLine && <div className="pace-forecast-req">{requiredLine}</div>}
              </div>
            )}
            {showMoney && (
              <div
                className="pace-forecast"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <span style={{ color: "var(--fg-2)", fontSize: 13 }}>Period earnings</span>
                <span style={{ color: "var(--good)", fontWeight: 600 }}>{fmtMoney(periodDollars)}</span>
              </div>
            )}
            <div className="pace-foot">
              <span>{formatPeriodLabel(period)}</span>
              <span>
                {statsPeriod.efficiency !== null
                  ? `${fmtPct(statsPeriod.efficiency)} eff`
                  : `Day ${currentDay} / ${periodDays}`}
              </span>
            </div>
          </EntranceGrid>
        </div>

        {/* ── Stat tiles ──────────────────────────────────────── */}
        <EntranceGrid className="stat-grid">
          <TodayCard
            date={today}
            stats={statsToday}
            initialHours={todaysClock?.hours ?? 0}
            library={library}
          />
          <StatCard label="This Week"      stats={statsWeek} />
          <StatCard label="Pay Period"     stats={statsPeriod} />
          <StatCard label="This Month"     stats={statsMonth} />
        </EntranceGrid>

        {/* ── Recent ROs ──────────────────────────────────────── */}
        <section>
          <div className="section-title">
            Recent ROs
            <Link href="/history" className="link">View all →</Link>
          </div>
          <div className="card flush">
            <RoList
              entries={recentEntries}
              library={library}
              rates={rateMap}
              emptyState={
                <EmptyState
                  icon={<ClipboardList size={22} />}
                  title="No ROs yet"
                  description="Every RO you flag here builds your pace and your record."
                  action={
                    <Link href="/log" className="btn btn-primary btn-sm">
                      Log an RO →
                    </Link>
                  }
                />
              }
            />
          </div>
        </section>

        {/* ── Averages chart ──────────────────────────────────── */}
        <AveragesChart
          entries={entries}
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

    </main>
  );
}
