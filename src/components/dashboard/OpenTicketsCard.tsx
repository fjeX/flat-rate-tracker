"use client";

// Dashboard — Open Tickets zone (Open Tickets plan, Phase 1).
//
// Renders ONLY when the user has at least one open ticket. Zero open = the
// zone is absent, not an empty state: a quiet dashboard should look quiet.
//
// One tag per ticket, oldest-opened first — the car that has sat longest is
// the one to chase. The status word is the ticket's LATEST timeline event
// (decision 5); days open count from the `opened` event, never created_at.
// Tap the RO number → the same RoDetailModal every other list opens.
//
// Tags, like Recent ROs, but with no duration bar: the bar is FLAGGED time,
// and an open ticket has not flagged anything yet. Its hours are open_work
// rows, attribution beside the flag, so they print as a figure with no bar.
import { useState } from "react";
import type { Entry, OpCode } from "@/lib/types";
import type { RateMap } from "@/lib/earnings";
import type { OpenTicketSummary } from "@/lib/open-tickets";
import { fmtHours } from "@/lib/stats";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { Badge } from "@/components/ui/Badge";
import { Zone } from "@/components/ui/Zone";
import { RoTag } from "./RoTag";

export function OpenTicketsCard({
  tickets,
  library = [],
  rates = {},
}: {
  tickets: OpenTicketSummary[];
  library?: OpCode[];
  rates?: RateMap;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (tickets.length === 0) return null;
  const openEntry: Entry | null =
    tickets.find((t) => t.entry.id === openId)?.entry ?? null;

  return (
    <Zone
      id="z-open"
      name="Open tickets"
      aside={
        <>
          <span className="num">{tickets.length}</span> open
        </>
      }
    >
      <ul className="tags" data-testid="open-tickets-card">
        {tickets.map((t) => {
          const vehicle = [t.entry.vehicle.year, t.entry.vehicle.make, t.entry.vehicle.model]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            <RoTag
              key={t.entry.id}
              roNumber={t.entry.roNumber}
              roLabel={`Open ticket RO ${t.entry.roNumber}, ${t.statusLabel}, open ${t.daysOpen} day${t.daysOpen === 1 ? "" : "s"}`}
              onOpen={() => setOpenId(t.entry.id)}
              headExtra={<Badge tone="neutral">{t.statusLabel}</Badge>}
              // Hours on the ticket so far — open_work rows, never flag. The
              // flag lands on the close day; this is attribution beside it.
              hours={fmtHours(t.hours)}
              hoursTitle="Hours on this ticket so far"
              body={
                <>
                  {/* "vehicle not set" is a real state, not a blank: the vehicle
                      is progressive on an open ticket (decision 2). */}
                  <div className={`tag-veh${vehicle ? "" : " is-unset"}`}>
                    {vehicle || "Vehicle not set"}
                  </div>
                  <p className="tag-meta">
                    Open <span className="num">{t.daysOpen}</span> day{t.daysOpen === 1 ? "" : "s"}
                  </p>
                </>
              }
            />
          );
        })}
      </ul>

      {openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          rates={rates}
          onClose={() => setOpenId(null)}
        />
      )}
    </Zone>
  );
}
