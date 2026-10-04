"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useGuestStore } from "@/lib/guest/context";
import { formatDateLong } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import { formatLoggedStamp } from "@/lib/ro-stamps";
import { jobRankSentences, toJobTimings } from "@/lib/rankings";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";

export function GuestRoDetailModal({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const { entries, opCodes, deleteGuestEntry, hourlyRate } = useGuestStore();
  const opCodesById = new Map(opCodes.map((oc) => [oc.id, oc]));
  // The guest store holds every guest RO in memory, so the ranking pool is the
  // whole session (the signed-in twin is handed its pool by the page instead).
  const rankByLine = useMemo(
    () =>
      jobRankSentences(
        entry,
        toJobTimings(entries),
        (line) => {
          const code = line.custom
            ? line.customCode?.trim()
            : line.opCodeId
              ? opCodesById.get(line.opCodeId)?.code
              : undefined;
          return code || null;
        },
      ),
    // opCodesById is rebuilt every render; its source array is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, entries, opCodes],
  );
  const showMoney = hourlyRate !== null && hourlyRate > 0;
  const roEarnings = showMoney ? entry.flagHours * hourlyRate : 0;
  const comebackLines = entry.opCodes.filter((l) => l.isComeback);
  const comebackLineCount = comebackLines.length;
  const comebackActual = comebackLines.reduce((s, l) => s + (l.actualHours ?? 0), 0);

  function handleDelete() {
    // Mirrors RoDetailModal: name the RO rather than describing every RO
    // equally, so a mis-click can't nuke the wrong row. The date is in here
    // on purpose — the shop recycles 5-digit RO numbers, so the number alone
    // does not identify a ticket.
    const ro = entry.roNumber?.trim();
    const vehicle = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
      .filter(Boolean)
      .join(" ")
      .trim();
    const bits = [
      vehicle || null,
      Number.isFinite(entry.flagHours) ? `${fmtHours(entry.flagHours)}h flagged` : null,
      // formatDateLong assumes "YYYY-MM-DD"; drop the clause rather than print
      // "undefined undefined, NaN".
      /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? formatDateLong(entry.date) : null,
    ].filter(Boolean);
    const head = ro ? `RO #${ro}` : "this RO";
    const what = bits.length > 0 ? `${head} — ${bits.join(", ")}` : head;
    if (!window.confirm(`Delete ${what}? This can't be undone.`)) return;
    deleteGuestEntry(entry.id);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`RO #${entry.roNumber}`}
      size="lg"
      footer={
        <div className="rod-foot">
          <Button variant="danger" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <div className="rod-foot-right">
            <Button variant="quiet" onClick={onClose}>Close</Button>
          </div>
        </div>
      }
    >
      <div className="rod-body">
        <div className="rod-meta">
          <div className="rod-date">{formatDateLong(entry.date)}</div>
          <div className="rod-logged">
            {formatLoggedStamp(entry.createdAt, entry.updatedAt)}
          </div>
          <GuestVehicleLine vehicle={entry.vehicle} />
        </div>

        {/* Op code lines: one table so Flag / Actual line up with the inputs. */}
        <div className="rod-lines">
          <table className="table rod-table">
            <thead>
              <tr>
                <th scope="col">Op code</th>
                <th scope="col" className="table-num rod-col-flag">Flag</th>
                <th scope="col" className="table-num rod-col-act">Actual</th>
              </tr>
            </thead>
            <tbody>
              {entry.opCodes.map((line) => (
                <GuestLineRow key={line.id} line={line} entryId={entry.id} opCodesMap={opCodesById} rank={rankByLine.get(line.id) ?? null} />
              ))}
            </tbody>
            <tfoot>
              <tr className="table-foot">
                <td>Flagged total</td>
                <td className="table-num">{fmtHours(entry.flagHours)}h</td>
                <td className="table-num">
                  {entry.opCodes.some((l) => l.actualHours !== null)
                    ? `${fmtHours(entry.opCodes.reduce((s, l) => s + (l.actualHours ?? 0), 0))}h`
                    : "—"}
                </td>
              </tr>
              {comebackLineCount > 0 && (
                <tr className="rod-sub">
                  <td colSpan={2}>
                    Unpaid rework · {comebackLineCount} line
                    {comebackLineCount !== 1 ? "s" : ""}
                  </td>
                  <td className="table-num">
                    {comebackActual > 0 ? `${fmtHours(comebackActual)}h` : "—"}
                  </td>
                </tr>
              )}
              {showMoney && (
                <tr className="rod-sub">
                  <td>Earnings</td>
                  <td colSpan={2} className="table-num rod-good">{fmtMoney(roEarnings)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {entry.notes && (
          <div className="card-inset rod-well">
            <h3 className="field-label">Notes</h3>
            <p className="rod-notes-text">{entry.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------

function GuestVehicleLine({ vehicle }: { vehicle: Entry["vehicle"] }) {
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  if (!label && !vehicle.vin && !vehicle.mileage) return null;
  return (
    <div className="rod-veh">
      {label && <div className="rod-veh-name">{label}</div>}
      {vehicle.vin && (
        <div className="rod-veh-line">
          VIN: <span className="num">{vehicle.vin}</span>
        </div>
      )}
      {vehicle.mileage && (
        <div className="rod-veh-line">
          Mileage: <span className="num">{vehicle.mileage}</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function GuestLineRow({
  line,
  entryId,
  opCodesMap,
  rank,
}: {
  line: EntryOpCode;
  entryId: string;
  opCodesMap: Map<string, OpCode>;
  rank: string | null;
}) {
  const { updateEntryHours } = useGuestStore();

  const ref = line.opCodeId ? opCodesMap.get(line.opCodeId) : undefined;
  const code = line.custom
    ? line.customCode?.trim() || "—"
    : ref?.code ?? "—";
  const description = line.custom
    ? line.customDescription?.trim() ?? ""
    : ref?.description ?? "";

  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );

  function commit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    updateEntryHours(entryId, line.id, parsed);
  }

  return (
    <tr>
      <td>
        <div className="rod-code">
          <Badge chip mono className="rod-code-main">{code}</Badge>
          {line.custom && <Badge>Other</Badge>}
          {line.isComeback && <Badge tone="warn">Comeback</Badge>}
        </div>
        {description && <div className="rod-desc">{description}</div>}
        {rank && <div className="rod-rank">{rank}</div>}
        {/* Mirrors RoDetailModal: a 0.0h line with no explanation reads as a
            mistake. Keep the two in step — they are separate forks. */}
        {line.isComeback && (
          <div className="rod-rework">Unpaid rework — flags no hours</div>
        )}
      </td>
      <td className="table-num rod-col-flag">{fmtHours(line.flagHours)}</td>
      <td className="rod-col-act rod-cell-in">
        <input
          type="number"
          min={0}
          step={0.1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="—"
          aria-label={`Actual hours for ${code}`}
          className="input num opc-hours-input rod-hours"
        />
      </td>
    </tr>
  );
}
