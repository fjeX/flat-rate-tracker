"use client";

// Dashboard — Open Tickets card (Open Tickets plan, Phase 1).
//
// Renders ONLY when the user has at least one open ticket. Zero open = the
// card is absent, not an empty state: a quiet dashboard should look quiet.
//
// One row per ticket, oldest-opened first — the car that has sat longest is
// the one to chase. The status chip is the ticket's LATEST timeline event
// (decision 5); days open count from the `opened` event, never created_at.
// Tap → the same RoDetailModal every other list opens.
import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import type { RateMap } from "@/lib/earnings";
import type { OpenTicketSummary } from "@/lib/open-tickets";
import { fmtHours } from "@/lib/stats";
import { RoDetailModal } from "@/components/ro/RoDetailModal";

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
    <section>
      <div className="section-title">
        Open tickets
        <span className="text-[var(--fg-3)]" style={{ letterSpacing: "normal", textTransform: "none", fontWeight: 500 }}>
          {tickets.length} open
        </span>
      </div>
      <div className="card flush">
        <div className="ro-list" data-testid="open-tickets-card">
          {tickets.map((t) => {
            const vehicle = [t.entry.vehicle.year, t.entry.vehicle.make, t.entry.vehicle.model]
              .filter(Boolean)
              .join(" ")
              .trim();
            return (
              <div key={t.entry.id} className="ro-row">
                <button
                  type="button"
                  className="ro-row-main"
                  onClick={() => setOpenId(t.entry.id)}
                  aria-label={`Open ticket RO ${t.entry.roNumber}, ${t.statusLabel}, open ${t.daysOpen} day${t.daysOpen === 1 ? "" : "s"}`}
                >
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="ro-num">#{t.entry.roNumber}</span>
                      <span className="badge badge-info">{t.statusLabel}</span>
                    </div>
                    {/* "vehicle not set" is a real state, not a blank: the vehicle
                        is progressive on an open ticket (decision 2). */}
                    <div className="ro-vehicle" style={vehicle ? undefined : { color: "var(--fg-3)" }}>
                      {vehicle || "Vehicle not set"}
                    </div>
                    <div className="ro-meta">
                      <FolderOpen size={12} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                      Open {t.daysOpen} day{t.daysOpen === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
                {/* Hours on the ticket so far — open_work rows, never flag. The
                    flag lands on the close day; this is attribution beside it. */}
                <div className="hours tabular" title="Hours on this ticket so far">
                  {fmtHours(t.hours)}
                  <span className="unit">h</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          rates={rates}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}
