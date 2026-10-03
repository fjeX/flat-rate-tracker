"use client";

// The guest edition of the signed-in dashboard: a page head, the headline panel
// (pay period flag hours, then what it earns once a rate is typed), a spec strip
// for today / this week / this month, the rate field, and the Recent ROs zone as
// tags. No clocks in guest mode, so there is no efficiency figure anywhere here.
import { useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { useClientToday } from "@/lib/use-client-today";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  getPeriodForDate,
  formatPeriodLabel,
  formatDateShort,
  formatLoggedTime,
} from "@/lib/periods";
import { aggregateStats, fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { lineCode } from "@/lib/line-code";
import type { DailyClock, Entry } from "@/lib/types";
import { GuestRateCard } from "@/components/guest/GuestRateCard";
import { GuestRoDetailModal } from "@/components/guest/GuestRoDetailModal";
import { GuestSyncedNote } from "@/components/dashboard/SyncedNote";
import { RoTag } from "@/components/dashboard/RoTag";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Head, HeadCell, HeadCells } from "@/components/ui/Card";
import { DurationBar } from "@/components/ui/DurationBar";
import { withPt } from "@/components/ui/Figure";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { Zone } from "@/components/ui/Zone";

const NO_CLOCKS: DailyClock[] = [];

function SpecFigure({ label, hours }: { label: string; hours: number }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <span className="num gst-spec-fig">
        {withPt(fmtHours(hours))}
        <span className="unit">h</span>
      </span>
    </div>
  );
}

export default function GuestDashboard() {
  const { entries, opCodes, settings, hourlyRate } = useGuestStore();
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  // Null until the browser has reported its own date — see the hook. Every
  // hook above this line stays above it; nothing below may be one.
  const today = useClientToday();
  if (!today) return null;
  const period = getPeriodForDate(today, settings.splitDay, settings.periodOverrides);

  const statsToday = aggregateStats(entries, NO_CLOCKS, { start: today, end: today });
  const statsWeek = aggregateStats(entries, NO_CLOCKS, {
    start: startOfWeek(today),
    end: endOfWeek(today),
  });
  const statsPeriod = aggregateStats(entries, NO_CLOCKS, { start: period.start, end: period.end });
  const statsMonth = aggregateStats(entries, NO_CLOCKS, {
    start: startOfMonth(today),
    end: endOfMonth(today),
  });

  const showMoney = hourlyRate !== null && hourlyRate > 0;
  const periodEarnings = showMoney ? statsPeriod.flagHours * hourlyRate : 0;
  const libraryById = new Map(opCodes.map((oc) => [oc.id, oc]));
  const recent = entries.slice(0, 5);

  return (
    <>
      <main className="gst-page">
        <div className="pagehead">
          <div className="grow">
            <h1>Dashboard</h1>
            <p>{formatPeriodLabel(period)}</p>
            <GuestSyncedNote />
          </div>
        </div>

        <Zone id="z-gst-period" name="Pay Period">
          <Head>
            <HeadCells>
              <HeadCell
                className="gst-flag"
                label="Pay Period · Flag"
                value={<RollingNumber value={fmtHours(statsPeriod.flagHours)} />}
                unit="h"
              />
              <HeadCell
                secondary
                label="Earned this period"
                value={showMoney ? withPt(fmtMoney(periodEarnings)) : "—"}
                sub={showMoney ? undefined : "Add your rate to see dollars"}
              />
            </HeadCells>
          </Head>
          <div className="spec gst-spec">
            <SpecFigure label="Today" hours={statsToday.flagHours} />
            <SpecFigure label="This Week" hours={statsWeek.flagHours} />
            <SpecFigure label="This Month" hours={statsMonth.flagHours} />
          </div>
          <GuestRateCard />
        </Zone>

        <Zone id="z-gst-ros" name="Recent ROs" link={{ href: "/guest/history", label: "View all" }}>
          {recent.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={22} />}
              title="Nothing on the books"
              description="Log your first RO and the flag hours start counting."
              action={
                <Link href="/guest/log" className="btn btn-go btn-sm">
                  Log your first RO →
                </Link>
              }
            />
          ) : (
            <>
              <p className="scale-note">
                <i aria-hidden="true" />
                Bar is flagged time. This length is 1.0 hour.
              </p>
              <ul className="tags">
                {recent.map((e) => {
                  const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  const when = [formatDateShort(e.date), formatLoggedTime(e.loggedTime)]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <RoTag
                      key={e.id}
                      roNumber={e.roNumber}
                      onOpen={() => setDetailEntry(e)}
                      headExtra={e.status === "open" ? <Badge tone="neutral">Open</Badge> : undefined}
                      when={when}
                      hours={fmtHours(e.flagHours)}
                      body={
                        <>
                          {vehicle && <div className="tag-veh">{vehicle}</div>}
                          {e.opCodes.length > 0 && (
                            <ul className="ops" aria-label="Op codes, flagged over actual hours">
                              {e.opCodes.map((line) => {
                                const flag = fmtHours(line.flagHours);
                                const actual =
                                  line.actualHours !== null ? fmtHours(line.actualHours) : "—";
                                return (
                                  <li key={line.id}>
                                    <b>{lineCode(line, libraryById)}</b>
                                    <span className="num">
                                      {withPt(flag)}/{withPt(actual)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          <DurationBar hours={e.flagHours} />
                        </>
                      }
                    />
                  );
                })}
              </ul>
            </>
          )}
        </Zone>
      </main>
      {detailEntry && (
        <GuestRoDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />
      )}
    </>
  );
}
