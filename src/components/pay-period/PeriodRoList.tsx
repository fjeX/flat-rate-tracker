"use client";

// The ROs in a pay period, as the final design's tags (mock variant 1 rows:
// `.tag` in final.html): one repair order each, with the RO number, when it was
// logged, the vehicle, the op codes as flagged/actual, and a duration bar whose
// length is the exact flagged time.
//
// Each row is the shared RoTag (components/dashboard/RoTag), the same tag the
// dashboard and History draw, so the three lists read as one kind of thing
// (folded in 2026-09-30; this file carried its own `pp-tag` copy before). Tap
// an RO to open its detail, and cap the list behind a "Show all N ROs" control
// when the page asks for a cap. The detail dialog is the shared RoDetailModal.
import { useState } from "react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort, formatLoggedTime } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import { lineCode } from "@/lib/line-code";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { Badge } from "@/components/ui/Badge";
import { RoTag } from "@/components/dashboard/RoTag";
import { Head, HeadRow } from "@/components/ui/Card";
import { DurationBar } from "@/components/ui/DurationBar";
import { withPt } from "@/components/ui/Figure";

export function PeriodRoList({
  entries,
  library = [],
  rates = {},
  emptyState,
  maxRows,
  periodFlagHours,
}: {
  entries: Entry[];
  library?: OpCode[];
  rates?: RateMap;
  emptyState?: React.ReactNode;
  /** Cap the visible rows behind a "Show all N ROs" control. Undefined shows every RO. */
  maxRows?: number;
  /** The period's flagged total, the same figure the headline shows. */
  periodFlagHours: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  // Resolve against the FULL list, not the visible slice — the detail modal
  // must still open for a row that a later collapse would hide.
  const openEntry = openId ? entries.find((e) => e.id === openId) : null;

  const capped = maxRows !== undefined && !showAll && entries.length > maxRows;
  const visible = capped ? entries.slice(0, maxRows) : entries;
  const hiddenCount = entries.length - visible.length;
  // The footing of the rows on screen. Summed from those rows, so the printed
  // figure always adds up to what the tech can see.
  const shownHours = visible.reduce((sum, e) => sum + e.flagHours, 0);

  if (entries.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <p className="scale-note">
        <i aria-hidden="true" />
        Bar is flagged time. This length is 1.0 hour.
      </p>

      <ul className="tags">
        {visible.map((e) => {
          const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
            .filter(Boolean)
            .join(" ")
            .trim();
          const logged = formatLoggedTime(e.loggedTime);
          return (
            <RoTag
              key={e.id}
              roNumber={e.roNumber}
              onOpen={() => setOpenId(e.id)}
              /* An open ticket's date is the OPENED day placeholder and its
                 hours read 0.0h — both true, both misleading without the
                 tag. The tag is the explanation. */
              headExtra={e.status === "open" && <Badge tone="neutral">Open</Badge>}
              /* Only when there is one. An RO logged before the feature, or
                 with the setting off, shows the date alone — no placeholder
                 and no dash, because "no time recorded" is not a value. */
              when={`${formatDateShort(e.date)}${logged ? ` · ${logged}` : ""}`}
              hours={fmtHours(e.flagHours)}
              body={
                <>
                  {vehicle && <div className="tag-veh">{vehicle}</div>}
                  {e.opCodes.length > 0 && (
                    <ul className="ops" aria-label="Op codes, flagged over actual hours">
                      {e.opCodes.map((line) => {
                        const code = lineCode(line, libraryById);
                        const flag = fmtHours(line.flagHours);
                        const actual =
                          line.actualHours !== null ? fmtHours(line.actualHours) : "–";
                        return (
                          <li key={line.id}>
                            <b>{code}</b>
                            <span className="num">{withPt(`${flag}/${actual}`)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <DurationBar
                    hours={e.flagHours}
                    label={`${e.flagHours.toFixed(1)} hours flagged`}
                  />
                </>
              }
            />
          );
        })}
      </ul>

      <div className="pp-tags-foot">
        <div className="pp-foot-row">
          <span className="pp-foot-k">
            Total, <span className="num">{visible.length}</span> shown
          </span>
          <span className="num">
            {withPt(fmtHours(shownHours))}
            <span className="pp-unit">h</span>
          </span>
        </div>
        <Head>
          <HeadRow>
            <span className="pp-foot-k">
              Period total, <span className="num">{entries.length}</span>{" "}
              {entries.length === 1 ? "RO" : "ROs"}
            </span>
            <span className="num">
              {withPt(fmtHours(periodFlagHours))}
              <span className="unit">h</span>
            </span>
          </HeadRow>
        </Head>
        {capped && (
          <div className="pp-more">
            <button type="button" onClick={() => setShowAll(true)} className="pp-more-btn">
              Show all <span className="num">{entries.length}</span> ROs
              {" · "}
              <span className="num">{hiddenCount}</span> hidden
            </button>
          </div>
        )}
      </div>

      {openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          rates={rates}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
