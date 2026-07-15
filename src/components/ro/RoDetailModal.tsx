"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EntryPhotos } from "@/components/ro/EntryPhotos";
import { LinkedSpiffs } from "@/components/bonuses/LinkedSpiffs";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateLong } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { entryEarnings, fmtMoney, hasAnyRate, lineEarnings, type RateMap } from "@/lib/earnings";
import {
  addOpCodeLineToEntryAction,
  deleteEntryAction,
  deleteEntryLineAction,
  setLineActualHoursAction,
} from "@/app/actions/entries";

export function RoDetailModal({
  entry,
  library = [],
  rates = {},
  onClose,
}: {
  entry: Entry;
  library?: OpCode[];
  rates?: RateMap;
  onClose: () => void;
}) {
  const router = useRouter();
  const libraryById = useMemo(() => new Map(library.map((oc) => [oc.id, oc])), [library]);
  const totalActual = entry.opCodes.reduce(
    (s, oc) => s + (oc.actualHours ?? 0),
    0,
  );
  const hasAnyActual = entry.opCodes.some((oc) => oc.actualHours !== null);
  // Dollars only surface once the user has priced at least one rate.
  const showMoney = hasAnyRate(rates);
  const roEarnings = showMoney ? entryEarnings(entry, rates) : 0;

  return (
    <Modal open onClose={onClose} title={`RO #${entry.roNumber}`} wide>
      <div className="space-y-4">
        <div className="text-xs text-[var(--fg-3)]">
          <div>{formatDateLong(entry.date)}</div>
          <div className="mt-0.5">
            Logged{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        </div>

        <VehicleLine
          year={entry.vehicle.year}
          make={entry.vehicle.make}
          model={entry.vehicle.model}
          vin={entry.vehicle.vin}
          mileage={entry.vehicle.mileage}
        />

        <div className="card-inset overflow-hidden">
          {/* Header, rows, and total all share this exact template (incl. the
              22px trash-button column) so Flag/Actual line up with the inputs. */}
          <div className="grid grid-cols-[1fr_64px_80px_22px] items-center gap-2 border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-3)]">
            <div>Op code</div>
            <div className="text-right">Flag</div>
            <div className="text-center">Actual</div>
            <div />
          </div>
          <ul>
            {entry.opCodes.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                libraryById={libraryById}
                isOnly={entry.opCodes.length === 1}
                onDeleted={() => router.refresh()}
                earnings={showMoney ? lineEarnings(line, rates) : null}
              />
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_64px_80px_22px] items-center gap-2 border-t border-[var(--line)] px-3 py-2 text-sm">
            <div className="text-[var(--fg-2)]">Total</div>
            <div className="text-right font-medium">
              {fmtHours(entry.flagHours)}h
            </div>
            <div className="text-center text-[var(--fg-2)]">
              {hasAnyActual ? `${fmtHours(totalActual)}h` : "—"}
            </div>
            <div />
          </div>
          {showMoney && (
            <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 text-sm">
              <span className="text-[var(--fg-2)]">Earnings</span>
              <span className="font-medium text-[var(--good)]">{fmtMoney(roEarnings)}</span>
            </div>
          )}
        </div>

        {/* Quick-add op code from library */}
        <AddOpCodePicker
          entryId={entry.id}
          library={library}
          onAdded={() => router.refresh()}
        />

        {entry.notes && (
          <div className="card-inset p-3">
            <div className="mb-1 text-xs text-[var(--fg-3)]">
              Notes
            </div>
            <p className="whitespace-pre-wrap text-sm text-[var(--fg-1)]">
              {entry.notes}
            </p>
          </div>
        )}

        {/* Photo evidence — thumbnails, attach, full-screen viewer. */}
        <EntryPhotos entryId={entry.id} />

        {/* Spiffs/bonuses attached to this RO (read-only). */}
        <LinkedSpiffs entryId={entry.id} />

        <Footer entryId={entry.id} onClose={onClose} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------

const DESC_CHAR_LIMIT = 80;

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= DESC_CHAR_LIMIT) {
    return <div className="text-xs text-[var(--fg-3)]">{text}</div>;
  }
  return (
    <div className="text-xs text-[var(--fg-3)]">
      {expanded ? text : text.slice(0, DESC_CHAR_LIMIT) + "…"}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        className="relative ml-1 py-2.5 text-[var(--brand)] hover:opacity-80 focus:outline-none"
      >
        {expanded ? "less" : "more"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------

function VehicleLine({
  year,
  make,
  model,
  vin,
  mileage,
}: {
  year: string;
  make: string;
  model: string;
  vin: string;
  mileage: string;
}) {
  const label = [year, make, model].filter(Boolean).join(" ").trim();
  if (!label && !vin && !mileage) return null;
  return (
    <div className="space-y-0.5">
      {label && <div className="text-sm text-[var(--fg-1)]">{label}</div>}
      {vin && (
        <div className="font-mono text-xs text-[var(--fg-3)]">
          VIN: {vin}
        </div>
      )}
      {mileage && (
        <div className="text-xs text-[var(--fg-3)]">
          Mileage: {mileage}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function LineRow({
  line,
  libraryById,
  isOnly,
  onDeleted,
  earnings,
}: {
  line: EntryOpCode;
  libraryById: Map<string, OpCode>;
  isOnly: boolean;
  onDeleted: () => void;
  earnings: number | null; // null when rates are off or this line's type is unpriced
}) {
  const router = useRouter();
  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  const code = line.custom
    ? (line.customCode ?? "").trim() || "—"
    : (ref?.code ?? "—");
  const subRef = line.subOpCodeId && ref
    ? ref.subOpCodes.find((s) => s.id === line.subOpCodeId)
    : undefined;
  const description = line.custom
    ? (line.customDescription ?? "").trim()
    : subRef
      ? subRef.description
      : (ref?.description ?? "");

  function commit() {
    const trimmed = text.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Invalid");
      return;
    }
    if (parsed === line.actualHours) return;
    setError(null);
    startSave(async () => {
      try {
        await setLineActualHoursAction(line.id, parsed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  function handleDelete() {
    if (isOnly) {
      alert("An RO needs at least one line.");
      return;
    }
    if (!window.confirm("Remove this line?")) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryLineAction(line.id);
        onDeleted();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove.");
      }
    });
  }

  return (
    <li className="border-b border-[var(--line)] px-3 py-2 last:border-b-0">
      <div className="grid grid-cols-[1fr_64px_80px_22px] items-center gap-2">
        <div className="min-w-0">
          <span className="font-mono text-sm text-[var(--brand)]">{code}</span>
          {subRef && (
            <Badge tone="brand" mono className="ml-2">
              {subRef.code}
            </Badge>
          )}
          {line.custom && <Badge className="ml-2">Other</Badge>}
          {description && <ExpandableDescription text={description} />}
          {earnings !== null && (
            <div className="mt-0.5 font-mono text-xs text-[var(--good)]">
              {fmtMoney(earnings)}
            </div>
          )}
        </div>
        <div className="text-right font-mono text-sm">
          {fmtHours(line.flagHours)}
        </div>
        <div className="flex justify-center">
          <input
            type="number"
            min={0}
            step={0.1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="—"
            disabled={saving || deleting}
            aria-label={`Actual hours for ${code}`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `line-error-${line.id}` : undefined}
            className="opc-hours-input on-inset"
          />
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || isOnly}
          aria-label="Remove line"
          className="relative rounded-[var(--radius-sm)] p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-30 after:absolute after:-inset-2.5 after:content-['']"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <div id={`line-error-${line.id}`} role="alert" className="mt-1 text-xs text-[var(--bad)]">{error}</div>}
      {line.notes && (
        <p className="mt-1.5 text-xs text-[var(--fg-3)] italic">{line.notes}</p>
      )}
    </li>
  );
}

// ------------------------------------------------------------------------

function AddOpCodePicker({
  entryId,
  library,
  onAdded,
}: {
  entryId: string;
  library: OpCode[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subPickOc, setSubPickOc] = useState<OpCode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (oc) =>
        oc.code.toLowerCase().includes(q) ||
        oc.description.toLowerCase().includes(q),
    );
  }, [search, library]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function addLine(oc: OpCode, subOpCodeId?: string) {
    setError(null);
    const flagHours = subOpCodeId
      ? (oc.subOpCodes.find((s) => s.id === subOpCodeId)?.flagHours ?? oc.flagHours)
      : oc.flagHours;
    startTransition(async () => {
      try {
        await addOpCodeLineToEntryAction(entryId, {
          opCodeId: oc.id,
          custom: false,
          customCode: null,
          customDescription: null,
          flagHours,
          actualHours: null,
          notes: "",
          subOpCodeId: subOpCodeId ?? null,
          laborType: null,
        });
        onAdded();
        setSearch("");
        setOpen(false);
        setSubPickOc(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add.");
      }
    });
  }

  function handleOpCodeClick(oc: OpCode) {
    if (oc.subOpCodes.length > 0) {
      setSubPickOc(oc);
    } else {
      addLine(oc);
    }
  }

  if (!library.length) return null;

  return (
    <div ref={containerRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add op code
        </button>
      ) : subPickOc ? (
        // Sub op code selection step
        <div className="card-inset overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
            <button
              type="button"
              onClick={() => setSubPickOc(null)}
              className="py-2.5 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)]"
            >
              ← Back
            </button>
            <span className="text-xs text-[var(--fg-2)]">
              Sub op code for{" "}
              <span className="font-mono text-[var(--brand)]">{subPickOc.code}</span>
            </span>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {subPickOc.subOpCodes.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => addLine(subPickOc, sub.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-3)] disabled:opacity-50"
                >
                  <span>
                    <span className="font-mono text-sm text-[var(--brand)]">{sub.code}</span>
                    {sub.description && (
                      <span className="ml-2 text-xs text-[var(--fg-2)]">{sub.description}</span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--fg-2)]">{sub.flagHours}h</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-xs text-[var(--bad)]">
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className="card-inset overflow-hidden focus-within:border-[var(--brand)] focus-within:shadow-[var(--ring)]">
          <div className="flex items-center gap-2 px-3">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--fg-3)]" />
            <label htmlFor="ro-detail-add-search" className="sr-only">Search op codes</label>
            <input
              id="ro-detail-add-search"
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search op codes…"
              className="min-h-[44px] w-full bg-transparent text-sm placeholder-[var(--fg-3)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              aria-label="Close op code search"
              className="relative text-[var(--fg-3)] hover:text-[var(--fg-1)] after:absolute after:-inset-2 after:content-['']"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-48 overflow-y-auto border-t border-[var(--line)]">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-[var(--fg-3)]">No matches.</li>
            ) : (
              filtered.map((oc) => (
                <li key={oc.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleOpCodeClick(oc)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-3)] disabled:opacity-50"
                  >
                    <span>
                      <span className="font-mono text-sm text-[var(--brand)]">{oc.code}</span>
                      <span className="ml-2 text-xs text-[var(--fg-3)]">{oc.description}</span>
                    </span>
                    <span className="text-xs text-[var(--fg-2)]">
                      {oc.subOpCodes.length > 0 ? "select →" : `${oc.flagHours}h`}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          {error && (
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-xs text-[var(--bad)]">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function Footer({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!window.confirm("Delete this RO? This can't be undone.")) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryAction(entryId);
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete.");
      }
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-[var(--bad)]">{error}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="danger" onClick={handleDelete} disabled={deleting}>
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete"}
        </Button>
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>Close</Button>
          <Link
            href={`/log?edit=${entryId}`}
            className="btn btn-primary"
          >
            <Pencil className="h-4 w-4" />
            Edit RO
          </Link>
        </div>
      </div>
    </div>
  );
}
