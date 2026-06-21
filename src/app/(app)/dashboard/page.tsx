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
import { aggregateStats, fmtPct } from "@/lib/stats";
import { TodayCard } from "@/components/dashboard/TodayCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { RoList } from "@/components/ro/RoList";
import { AveragesChart } from "@/components/dashboard/AveragesChart";
import { GuestSyncEffect } from "@/components/guest/GuestSyncEffect";
import { CountUp } from "@/components/dashboard/CountUp";
import { EmptyState } from "@/components/ui/EmptyState";
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

function greetingWord(tz?: string): string {
  const h = tz
    ? parseInt(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: tz }), 10)
    : new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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
  const displayName = firstName?.trim() || email.split("@")[0] || "there";

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

  const [entries, clocks, library] = await Promise.all([
    db.listEntries(supabase, { from: fetchFrom, to: monthEnd }),
    db.listDailyClocks(supabase, { from: fetchFrom, to: monthEnd }),
    db.listOpCodes(supabase),
  ]);

  const statsToday  = aggregateStats(entries, clocks, { start: today, end: today });
  const statsWeek   = aggregateStats(entries, clocks, { start: weekStart, end: weekEnd });
  const statsPeriod = aggregateStats(entries, clocks, { start: period.start, end: period.end });
  const statsMonth  = aggregateStats(entries, clocks, { start: monthStart, end: monthEnd });

  const todaysClock  = clocks.find((c) => c.date === today);
  const recentEntries = entries.slice(0, 5);

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
  const actualFill  = Math.min(statsPeriod.flagHours / goalHours, 1);
  // Expected hours at this point in the period
  const expectedNow = (currentDay / periodDays) * goalHours;
  const paceRatio   = expectedNow > 0 ? statsPeriod.flagHours / expectedNow : null;

  // Pill: good ≥ 95% of pace, warn 80–95%, bad < 80%
  let pillClass = "";
  let pillLabel = "On pace";
  if (paceRatio === null) {
    pillClass = "neutral";
    pillLabel = "No data";
  } else if (paceRatio >= 0.95) {
    pillClass = "";      // default pill = good
    pillLabel = "On pace";
  } else if (paceRatio >= 0.80) {
    pillClass = "warn";
    pillLabel = "Slightly behind";
  } else {
    pillClass = "bad";
    pillLabel = "Behind pace";
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
              <h2>{greetingWord(tz)}, {displayName}</h2>
              <p>
                {formatPeriodLabel(period)}
                {" · "}
                Day {currentDay} of {periodDays}
              </p>
            </div>
            <span className={`pill${pillClass ? " " + pillClass : ""}`}>
              {pillLabel}
            </span>
          </div>
          <div style={{ height: 1, background: "var(--line)", margin: "0 16px" }} />
          <div className="pace">
            <div className="pace-head">
              <span className="title">
                Pay Period Pace
                <span className="pace-head-meta"> · {daysLeft} {daysLeft === 1 ? "day" : "days"} left</span>
              </span>
            </div>
            <div className="pace-values">
              <span className="pace-now">
                <CountUp value={statsPeriod.flagHours} /><span className="pace-unit"> flag hrs</span>
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
            <div className="pace-foot">
              <span>{formatPeriodLabel(period)}</span>
              <span>
                {statsPeriod.efficiency !== null
                  ? `${fmtPct(statsPeriod.efficiency)} eff`
                  : `Day ${currentDay} / ${periodDays}`}
              </span>
            </div>
          </div>
        </div>

        {/* ── Stat tiles ──────────────────────────────────────── */}
        <div className="stat-grid">
          <TodayCard
            date={today}
            stats={statsToday}
            initialHours={todaysClock?.hours ?? 0}
            library={library}
          />
          <StatCard label="This Week"      stats={statsWeek} />
          <StatCard label="Pay Period"     stats={statsPeriod} />
          <StatCard label="This Month"     stats={statsMonth} />
        </div>

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
              emptyState={
                <EmptyState
                  icon={<ClipboardList size={22} />}
                  title="No ROs logged yet"
                  description="Log your first repair order to start tracking flag hours and pace."
                  action={
                    <Link href="/log" className="btn btn-primary btn-sm">
                      Log your first RO →
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
