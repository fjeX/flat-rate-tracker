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
import { useEffect, useRef, useState, useTransition } from "react";
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
  reopenTicketAction,
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
  // The card-level alert: the timeline LOAD failure only. Nothing a tech taps
  // reports through it any more (see actionError below).
  const [loadError, setLoadError] = useState<string | null>(null);
  // A failed delete / reopen, rendered where the tech acted
  // (timeline-delete-error-offscreen, 2026-09-28). The top-of-card alert sat
  // above two unbounded lists, and Reopen sits BELOW them, so on a long
  // timeline the refusal landed off-screen; a failed delete leaves its row in
  // place, so the tap looked dead. `target` names the row (or "reopen") the
  // message belongs to — one slot, so a later failure on another row moves the
  // message there instead of leaving a stale one behind.
  const [actionError, setActionError] = useState<{ target: string; message: string } | null>(null);
  const [busy, startTransition] = useTransition();

  /**
   * Runs one delete/reopen write and reports a refusal against `target`.
   * Clears any previous action error first: the next attempt is a new answer.
   */
  function runAction(
    target: string,
    write: () => Promise<{ error?: string }>,
    fallback: string,
  ) {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await write();
        if (res.error) setActionError({ target, message: res.error });
        else afterWrite();
      } catch (e) {
        setActionError({ target, message: actionErrorMessage(e, fallback) });
      }
    });
  }

  function errorFor(target: string): string | null {
    return actionError?.target === target ? actionError.message : null;
  }

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
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(actionErrorMessage(e, "Couldn't load the timeline."));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, reload]);

  function clearStale() {
    setActionError(null);
    setLoadError(null);
  }

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

      {loadError && (
        <p role="alert" className="mb-2 text-xs text-[var(--bad)]">{loadError}</p>
      )}

      {/* ---- The story ---- */}
      <ol className="space-y-1.5">
        {(events ?? []).map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-start justify-between gap-x-2 text-sm">
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
                  runAction(
                    `event:${ev.id}`,
                    () => deleteRoEventAction(ev.id),
                    "Couldn't remove that.",
                  );
                }}
                aria-label={`Remove event ${eventLabel(ev)} on ${formatDateShort(ev.date)}`}
                className="relative rounded-[var(--radius-sm)] p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-30 after:absolute after:-inset-2.5 after:content-['']"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <InlineAlert
              error={errorFor(`event:${ev.id}`)}
              testId={`event-error-${ev.id}`}
              className="basis-full"
            />
          </li>
        ))}
      </ol>

      {isOpen && (
        <AddEventForm
          entryId={entry.id}
          today={today}
          busy={busy}
          onClearStale={clearStale}
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
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
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
                        runAction(
                          `work:${u.id}`,
                          () => deleteOpenWorkAction(u.id),
                          "Couldn't delete that.",
                        );
                      }}
                      aria-label={`Delete ${fmtHours(u.hours)} hours on ${formatDateShort(u.date)}`}
                      className="relative rounded-[var(--radius-sm)] p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-30 after:absolute after:-inset-2.5 after:content-['']"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <InlineAlert
                    error={errorFor(`work:${u.id}`)}
                    testId={`work-error-${u.id}`}
                    className="basis-full"
                  />
                </li>
              ))}
            </ul>
          )}
          {isOpen && (
            <AddHoursForm
              entryId={entry.id}
              today={today}
              busy={busy}
              onClearStale={clearStale}
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

      {/* Phase 2 (decision 11): closed by mistake, or a second approved line
          came in. The timeline and lines stay read-only either way — reopen
          only flips status and writes the `reopened` event; the tech closes
          again through the same close flow to add or edit lines. */}
      {!isOpen && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 border-t border-[var(--line)] pt-3">
          <span className="text-xs text-[var(--fg-3)]">
            Closed by mistake, or a second approved line?
          </span>
          <button
            type="button"
            disabled={busy}
            data-testid="reopen-ticket"
            className="btn btn-sm"
            onClick={() =>
              runAction(
                "reopen",
                () => reopenTicketAction(entry.id),
                "Couldn't reopen that ticket.",
              )
            }
          >
            Reopen
          </button>
          <InlineAlert
            error={errorFor("reopen")}
            testId="reopen-error"
            className="mt-1 basis-full text-right"
          />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

type AddFormProps = {
  entryId: string;
  today: string;
  busy: boolean;
  /**
   * Clears the parent's stale errors — a failed delete/reopen's inline line
   * and the load alert. The add forms do NOT report their own refusals through
   * the parent (open-work-hours-refusal-unseen, 2026-09-27): the old single
   * alert sat above the event list, the add forms sit at the bottom, and on a
   * long timeline a server refusal ("Hours can't exceed 24 in a day.") landed
   * off-screen and Save looked dead. Each add body owns its own error,
   * rendered next to its Save button — and since 2026-09-28
   * (timeline-delete-error-offscreen) delete and reopen do the same, beside
   * the row / button the tech tapped. This prop only keeps the old clearing:
   * a stale error from another write is not about the form being opened.
   */
  onClearStale: () => void;
  onSaved: () => void;
};

/**
 * A write's refusal line, rendered next to where the tech acted — beside an
 * add form's Save, under a deleted row, under Reopen. Placement, not
 * scrollIntoView, is the fix: the message is already where the tech's eyes
 * are, so nothing has to yank the modal's scroll position around.
 */
function InlineAlert({
  error,
  testId,
  className = "",
}: {
  error: string | null;
  testId: string;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p role="alert" className={`text-xs text-[var(--bad)] ${className}`} data-testid={testId}>
      {error}
    </p>
  );
}

/**
 * The collapsed/open shell. It owns NOTHING but `open` — every field lives in
 * the body component below, which is conditionally rendered and therefore
 * genuinely unmounts on close.
 *
 * That unmount IS the reset (timeline-form-no-reset-on-open, 2026-09-13). The
 * old shape kept the fields in this component and made "collapsed" an early
 * return, so kind/date/time rode from one open to the next through both Save
 * and Cancel: a time typed for one event reappeared on a later Custom event,
 * and hours meant for today were logged into yesterday's date. RetroTimePrompt
 * (see its header comment) had the same bug and had to fix it with a
 * reset-on-open effect only because LogRoForm renders it unconditionally and it
 * can never unmount. Here we control the render, so unmounting is the stronger
 * fix: a field added later cannot be forgotten by a reset list that nobody
 * updated, and pending/error state inside the body goes with it.
 */
function AddEventForm(props: AddFormProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // A stale banner from the last failed write is not about the form the
          // tech is opening now.
          props.onClearStale();
          setOpen(true);
        }}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        data-testid="add-event-open"
      >
        <Plus className="h-3.5 w-3.5" />
        Add event
      </button>
    );
  }

  return <AddEventFields {...props} onDone={() => setOpen(false)} />;
}

function AddEventFields({
  entryId,
  today,
  busy,
  onClearStale,
  onSaved,
  onDone,
}: AddFormProps & { onDone: () => void }) {
  // This body's own refusal. It unmounts with the body, so Cancel/close
  // clears it for free — same reset-by-unmount as the fields.
  const [error, setError] = useState<string | null>(null);
  // First-mount values ARE the defaults, and this component only ever exists
  // while the form is open — so there is no second open to carry them into.
  const [kind, setKind] = useState<RoEventKind>("diag_done");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  // This form's OWN pending flag. The `busy` prop is the parent's transition
  // (delete / reopen) and is never set by an add — reading only it left Save
  // live during the whole write, so a second tap wrote a second event and a
  // second open_work ledger row (money-adjacent, 2026-09-13).
  const [pending, startTransition] = useTransition();
  // Belt and braces: `pending` is only true after React commits the next
  // render, so a keyboard Enter or a click queued in the same tick could still
  // slip through an enabled button. The ref flips synchronously inside submit.
  const sending = useRef(false);

  function submit() {
    if (sending.current || pending) return;
    sending.current = true;
    setError(null);
    onClearStale();
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
          setError(res.error);
          return;
        }
        onDone();
        onSaved();
      } catch (e) {
        setError(actionErrorMessage(e, "Couldn't add that event."));
      } finally {
        // On success this component is unmounting anyway; on failure the form
        // stays open with the tech's typing, so it must be retryable.
        sending.current = false;
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2" data-testid="add-event-form">
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
        {/* Note/Label sits directly under "What happened" so picking Custom
            points straight at the field it turns into the label. */}
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
        <label className="text-xs text-[var(--fg-3)]">
          Time <span className="text-[var(--fg-3)]">(optional)</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="input mt-1 w-full"
          />
        </label>
      </div>
      <InlineAlert error={error} testId="add-event-error" />
      <div className="flex justify-end gap-2">
        {/* Cancel is disabled mid-write too: unmounting the body does not
            cancel the write, so letting it close would leave the tech asking
            "did that save?" while the row lands anyway. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDone}
          disabled={pending || busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={pending || busy || (kind === "custom" && note.trim() === "")}
          data-testid="add-event-save"
        >
          Add event
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------

/** Same shell/body split, same reason — see AddEventForm above. */
function AddHoursForm(props: AddFormProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          props.onClearStale();
          setOpen(true);
        }}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        data-testid="add-hours-open"
      >
        <Plus className="h-3.5 w-3.5" />
        Add hours for a day
      </button>
    );
  }

  return <AddHoursFields {...props} onDone={() => setOpen(false)} />;
}

function AddHoursFields({
  entryId,
  today,
  busy,
  onClearStale,
  onSaved,
  onDone,
}: AddFormProps & { onDone: () => void }) {
  // This body's own refusal. It unmounts with the body, so Cancel/close
  // clears it for free — same reset-by-unmount as the fields.
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  // Same story as AddEventFields: our own pending flag, not the parent's.
  // A double tap here duplicated a ledger row — hours the tech gets paid for.
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  function submit() {
    if (sending.current || pending) return;
    sending.current = true;
    const parsed = Number(hours);
    setError(null);
    onClearStale();
    startTransition(async () => {
      try {
        const res = await addOpenWorkAction({ entryId, date, hours: parsed, note });
        if (res.error) {
          setError(res.error);
          return;
        }
        onDone();
        onSaved();
      } catch (e) {
        setError(actionErrorMessage(e, "Couldn't add those hours."));
      } finally {
        sending.current = false;
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2" data-testid="add-hours-form">
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
      <InlineAlert error={error} testId="add-hours-error" />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDone}
          disabled={pending || busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={pending || busy || hours.trim() === ""}
          data-testid="add-hours-save"
        >
          Add hours
        </button>
      </div>
    </div>
  );
}
