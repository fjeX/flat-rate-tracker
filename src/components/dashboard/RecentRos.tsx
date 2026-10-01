"use client";

// The Recent ROs zone: the last five ROs as tags, each with a duration bar
// (length = the exact flagged time, one block per hour).
//
// This is the dashboard's own list (the old RoList is gone); it exists because
// the mock's tag is a different object (hole, hours top right, duration bar), and
// the dashboard is the only page that has the Upsell shortcut. What it keeps
// from RoList, on purpose: tap the RO number for the detail dialog, the Upsell
// shortcut opening that dialog with the op-code picker already up, the Open
// chip, the date + logged time, and the empty state.
import { useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort, formatLoggedTime } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import type { RateMap } from "@/lib/earnings";
import { lineCode } from "@/lib/line-code";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DurationBar } from "@/components/ui/DurationBar";
import { withPt } from "@/components/ui/Figure";
import { DashIcon } from "./DashIcon";
import { Zone } from "@/components/ui/Zone";
import { RoTag } from "./RoTag";

export function RecentRos({
  entries,
  library = [],
  rates = {},
}: {
  entries: Entry[];
  library?: OpCode[];
  rates?: RateMap;
}) {
  // `addLine` carries WHY the dialog opened: tapping the RO number is "show me
  // this RO", tapping Upsell is "I need to add a line to it". Same dialog,
  // different starting state — see RoDetailModal's autoOpenAddLine.
  const [open, setOpen] = useState<{ id: string; addLine: boolean } | null>(null);
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const openEntry = open ? entries.find((e) => e.id === open.id) : null;
  // Dashboard only. The customer approves extra work while the day is still
  // running, and this is the page that's open then. The picker renders nothing
  // without a library, so a button that opens an empty picker does nothing.
  const upsellShortcut = library.length > 0;

  return (
    <Zone id="z-ros" name="Recent ROs" link={{ href: "/history", label: "View all" }}>
      {entries.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="No ROs yet"
          description="Every RO you flag here builds your pace and your record."
          action={
            <Link href="/log" className="btn btn-go btn-sm">
              Log an RO →
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
            {entries.map((e) => {
              const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
                .filter(Boolean)
                .join(" ")
                .trim();
              // Only when there is one. An RO logged before the feature, or
              // with the setting off, shows the date alone — "no time recorded"
              // is not a value.
              const when = [formatDateShort(e.date), formatLoggedTime(e.loggedTime)]
                .filter(Boolean)
                .join(" · ");
              return (
                <RoTag
                  key={e.id}
                  roNumber={e.roNumber}
                  onOpen={() => setOpen({ id: e.id, addLine: false })}
                  // An open ticket's date is the OPENED day placeholder and its
                  // hours read 0.0h — both true, both misleading without the
                  // chip. The chip is the explanation.
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
                  action={
                    upsellShortcut ? (
                      <Button
                        variant="quiet"
                        onClick={() => setOpen({ id: e.id, addLine: true })}
                        aria-label={`Add an upsell to RO ${e.roNumber}`}
                      >
                        <DashIcon name="plus" />
                        Upsell
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        </>
      )}

      {openEntry && (
        <RoDetailModal
          entry={openEntry}
          library={library}
          rates={rates}
          autoOpenAddLine={open?.addLine}
          onClose={() => setOpen(null)}
        />
      )}
    </Zone>
  );
}
