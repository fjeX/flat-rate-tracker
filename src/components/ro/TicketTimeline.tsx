"use client";

// RO detail modal — the Timeline section (Open Tickets plan, Phase 1).
//
// Shown for EVERY RO that has at least one timeline event; an open ticket
// always has one (the server writes `opened`). Two lists, deliberately apart:
//
//   * the STORY — ro_events, chronological. Kind label, date, optional time,
//     note. A custom event shows its note as its label.
//   * the HOURS — the ticket's open_work ledger rows, one per day, each
//     deletable by primary key behind a named confirm (the 2026-09-07 rule:
//     never identify a ledger row by its hours).
//
// Hours never ride on events (decision 4), so editing the story can never
// change a day total, and this component never sums anything into a stat —
// the stats layer reads the same ledger rows itself.
//
// Signed-in only by construction: it is reached from RoDetailModal, which the
// guest surfaces render with a guest entry the actions cannot resolve; the
// modal only mounts this when the entry is not a guest one.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import type { Entry, RoEvent, RoEventKind, UnpaidTime } from "@/lib/types";
import { RO_EVENT_KIND_LABELS, RO_EVENT_PICKABLE_KINDS } from "@/lib/types";
import { eventLabel, openWorkRows } from "@/lib/open-tickets";
import { formatDateShort, formatLoggedTime, isoDate } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { actionErrorMessage } from "@/lib/action-error";
import {
  addOpenWorkAction,
  addRoEventAction,
  deleteOpenWorkAction,
  deleteRoEventAction,
  getTicketTimelineAction,
} from "@/app/actions/open-tickets";

/** The kinds a tech can pick, in the order the job usually goes. */
const PICKABLE: { kind: RoEventKind; label: string }[] = RO_EVENT_PICKABLE_KINDS.map(
  (kind) => ({ kind, label: RO_EVENT_KIND_LABELS[kind] }),
);

/** Milestones the server wrote; shown, never deletable (see deleteRoEvent). */
const TRANSITION_KINDS: ReadonlySet<RoEventKind> = new Set([
  "opened",
  "closed",
  "reopened",
]);

export function TicketTimeline({
  entry,
  onChanged,
}: {
  entry: Entry;
  /** Called after any write so the parent can refresh its server data. */
  onChanged: () => void;
}) {
  const isOpen = entry.status === "open";
  // The add forms default their date to the browser's local today. Read in a
  // client component that only mounts after a tap, so there is no SSR string
  // to disagree with — the same read useLogRoForm makes for a new RO. The
  // tech can change it; the server never trusts it for anything but the row.
  const today = isoDate();
  const [events, setEvents] = useState<RoEvent[] | null>(null);
  const [ledger, setLedger] = useState<UnpaidTime[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Reload counter: the section owns its own reads (like LinkedSpiffs), so a
  // write here re-reads here rather than waiting for a parent refresh that
  // may not repaint a modal already on screen.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTicketTimelineAction(entry.id);
        if (cancelled) return;
        setEvents(t.events);
        setLedger(t.ledger);
      } catch (e) {
        if (!cancelled) setError(actionErrorMessage(e, "Couldn't load the timeline."));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, reload]);

  function afterWrite() {
    setReload((n) => n + 1);
    onChanged();
  }

  // Nothing to show, and nothing to add to: a closed RO with no timeline is an
  // ordinary RO, and this section must not appear on it.
  if (!loaded) return null;
  if (!isOpen && (events === null || events.length === 0)) return null;

  const work = openWorkRows(ledger);
  const workTotal = work.reduce((s, u) => s + u.hours, 0);

  return (
    <div className="card-inset p-3" data-testid="ticket-timeline">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
          <CalendarClock className="h-3.5 w-3.5" />
          Timeline
        </div>
        {isOpen && (
          <span className="badge badge-info">Open ticket</span>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--bad)]">{error}</p>
      )}

      {/* ---- The story ---- */}
      <ol className="space-y-1.5">
        {(events ?? []).map((ev) => (
          <li key={ev.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className="text-[var(--fg-1)]">{eventLabel(ev)}</span>
              <span className="ml-2 text-xs text-[var(--fg-3)]">
                {formatDateShort(ev.date)}
                {formatLoggedTime(ev.time) && ` · ${formatLoggedTime(ev.time)}`}
              </span>
              {ev.kind !== "custom" && ev.note && (
                <div className="text-xs italic text-[var(--fg-3)]">{ev.note}</div>
              )}
            </div>
            {isOpen && !TRANSITION_KINDS.has(ev.kind) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Remove "${eventLabel(ev)}" on ${formatDateShort(ev.date)}?`)) return;
                  setError(null);
                  startTransition(async () => {
                    try {
                      const res = await deleteRoEventAction(ev.id);
                      if (res.error) setError(res.error);
                      else afterWrite();
                    } catch (e) {
                      setError(actionErrorMessage(e, "Couldn't remove that."));
                    }
                  });
                }}
                aria-label={`Remove event ${eventLabel(ev)} on ${formatDateShort(ev.date)}`}
                className="relative rounded-[var(--radius-sm)] p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-30 after:absolute after:-inset-2.5 after:content-['']"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ol>

      {isOpen && (
        <AddEventForm
          entryId={entry.id}
          today={today}
          busy={busy}
          onError={setError}
          onSaved={afterWrite}
        />
      )}

      {/* ---- The hours ---- */}
      {(work.length > 0 || isOpen) && (
        <div className="mt-3 border-t border-[var(--line)] pt-2">
          <div className="flex items-center justify-between text-xs text-[var(--fg-3)]">
            <span>Hours on this ticket</span>
            <span className="font-mono text-[var(--fg-2)]">{fmtHours(workTotal)}h</span>
          </div>
          {work.length > 0 && (
            <ul className="mt-1 space-y-1">
              {work.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--fg-2)]">{formatDateShort(u.date)}</span>
                    <span className="ml-2 font-mono">{fmtHours(u.hours)}h</span>
                    {u.source === "timer" && (
                      <span className="badge badge-neutral ml-2">timer</span>
                    )}
                    {u.note && (
                      <span className="ml-2 text-xs italic text-[var(--fg-3)]">{u.note}</span>
                    )}
                  </span>
                  {isOpen && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        // Name the row: reason, hours and date — the 2026-09-07
                        // rule for deleting a ledger record.
                        if (!window.confirm(`Delete ${fmtHours(u.hours)}h on this ticket for ${formatDateShort(u.date)}? This can't be undone.`)) return;
                        setError(null);
                        startTransition(async () => {
                          try {
                            const res = await deleteOpenWorkAction(u.id);
                            if (res.error) setError(res.error);
                            else afterWrite();
                          } catch (e) {
                            setError(actionErrorMessage(e, "Couldn't delete that."));
                          }
                        });
                      }}
                      aria-label={`Delete ${fmtHours(u.hours)} hours on ${formatDateShort(u.date)}`}
                      className="relative rounded-[var(--radius-sm)] p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-30 after:absolute after:-inset-2.5 after:content-['']"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOpen && (
            <AddHoursForm
              entryId={entry.id}
              today={today}
              busy={busy}
              onError={setError}
              onSaved={afterWrite}
            />
          )}
        </div>
      )}

      {isOpen && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <span className="text-xs text-[var(--fg-3)]">
            Op codes known? Close it to log the flag.
          </span>
          <Link
            href={`/log?edit=${entry.id}&close=1`}
            className="btn btn-primary btn-sm"
            data-testid="close-ticket-link"
          >
            Close ticket
          </Link>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function AddEventForm({
  entryId,
  today,
  busy,
  onError,
  onSaved,
}: {
  entryId: string;
  today: string;
  busy: boolean;
  onError: (msg: string | null) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RoEventKind>("diag_done");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        data-testid="add-event-open"
      >
        <Plus className="h-3.5 w-3.5" />
        Add event
      </button>
    );
  }

  function submit() {
    onError(null);
    startTransition(async () => {
      try {
        const res = await addRoEventAction({
          entryId,
          kind,
          date,
          time: time.trim() === "" ? null : time,
          note,
        });
        if (res.error) {
          onError(res.error);
          return;
        }
        setOpen(false);
        setNote("");
        onSaved();
      } catch (e) {
        onError(actionErrorMessage(e, "Couldn't add that event."));
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--fg-3)]">
          What happened
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RoEventKind)}
            className="input mt-1 w-full"
          >
            {PICKABLE.map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--fg-3)]">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input mt-1 w-full"
            required
          />
        </label>
        <label className="text-xs text-[var(--fg-3)]">
          Time <span className="text-[var(--fg-3)]">(optional)</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-xs text-[var(--fg-3)]">
          {kind === "custom" ? "Label" : "Note"}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === "custom" ? "e.g. Claim #4471 filed" : "optional"}
            className="input mt-1 w-full"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={busy || (kind === "custom" && note.trim() === "")}
        >
          Add event
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------

function AddHoursForm({
  entryId,
  today,
  busy,
  onError,
  onSaved,
}: {
  entryId: string;
  today: string;
  busy: boolean;
  onError: (msg: string | null) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        data-testid="add-hours-open"
      >
        <Plus className="h-3.5 w-3.5" />
        Add hours for a day
      </button>
    );
  }

  function submit() {
    const parsed = Number(hours);
    onError(null);
    startTransition(async () => {
      try {
        const res = await addOpenWorkAction({ entryId, date, hours: parsed, note });
        if (res.error) {
          onError(res.error);
          return;
        }
        setOpen(false);
        setHours("");
        setNote("");
        onSaved();
      } catch (e) {
        onError(actionErrorMessage(e, "Couldn't add those hours."));
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--fg-3)]">
          Day
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input mt-1 w-full"
            required
          />
        </label>
        <label className="text-xs text-[var(--fg-3)]">
          Hours
          <input
            type="number"
            min={0}
            max={24}
            step={0.1}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="8.0"
            className="input mono tabular mt-1 w-full"
            data-testid="add-hours-input"
          />
        </label>
        <label className="col-span-2 text-xs text-[var(--fg-3)]">
          Note <span className="text-[var(--fg-3)]">(optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="teardown, looking for the cause"
            className="input mt-1 w-full"
          />
        </label>
      </div>
      {/* Hold time is not hours on the ticket — it stays in its own unpaid
          bucket. Said once, here, where the tech is typing. */}
      <p className="text-[11px] text-[var(--fg-3)]">
        Hours you worked on it. Waiting on parts or approval is logged as unpaid time, not here.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={busy || hours.trim() === ""}
          data-testid="add-hours-save"
        >
          Add hours
        </button>
      </div>
    </div>
  );
}
