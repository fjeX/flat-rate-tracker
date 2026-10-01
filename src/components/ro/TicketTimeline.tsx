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
import { CalendarClock, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
    <div className="card-inset rod-well" data-testid="ticket-timeline">
      <div className="rod-well-head">
        <h3 className="field-label rod-well-name">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Timeline
        </h3>
        {isOpen && (
          <span className="badge badge-info">Open ticket</span>
        )}
      </div>

      {loadError && (
        <p role="alert" className="rod-inline-err">{loadError}</p>
      )}

      {/* ---- The story ---- */}
      <ol className="rod-rule">
        {(events ?? []).map((ev) => (
          <li key={ev.id}>
            <div className="rod-main">
              <span>{eventLabel(ev)}</span>
              <span className="rod-when">
                {formatDateShort(ev.date)}
                {formatLoggedTime(ev.time) && ` · ${formatLoggedTime(ev.time)}`}
              </span>
              {ev.kind !== "custom" && ev.note && (
                <div className="rod-note">{ev.note}</div>
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
                className="rod-x"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <InlineAlert
              error={errorFor(`event:${ev.id}`)}
              testId={`event-error-${ev.id}`}
              className="rod-basis"
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
        <div>
          <div className="rod-hours-head">
            <span className="field-label">Hours on this ticket</span>
            <span className="rod-fig">{fmtHours(workTotal)}h</span>
          </div>
          {work.length > 0 && (
            <ul className="rod-rule">
              {work.map((u) => (
                <li key={u.id}>
                  <span className="rod-hours-row rod-main">
                    <span>{formatDateShort(u.date)}</span>
                    <span className="rod-fig">{fmtHours(u.hours)}h</span>
                    {u.source === "timer" && (
                      <span className="badge badge-neutral">timer</span>
                    )}
                    {u.note && (
                      <span className="rod-note">{u.note}</span>
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
                      className="rod-x"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <InlineAlert
                    error={errorFor(`work:${u.id}`)}
                    testId={`work-error-${u.id}`}
                    className="rod-basis"
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
        <div className="rod-cta">
          <span className="rod-fine">
            Op codes known? Close it to log the flag.
          </span>
          <Link
            href={`/log?edit=${entry.id}&close=1`}
            className="btn btn-go btn-sm"
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
        <div className="rod-cta">
          <span className="rod-fine">
            Closed by mistake, or a second approved line?
          </span>
          <Button
            size="sm"
            disabled={busy}
            data-testid="reopen-ticket"
            onClick={() =>
              runAction(
                "reopen",
                () => reopenTicketAction(entry.id),
                "Couldn't reopen that ticket.",
              )
            }
          >
            Reopen
          </Button>
          <InlineAlert
            error={errorFor("reopen")}
            testId="reopen-error"
            className="rod-basis"
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
    <p role="alert" className={`rod-inline-err ${className}`} data-testid={testId}>
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
      <Button
        block
        className="rod-open-add"
        onClick={() => {
          // A stale banner from the last failed write is not about the form the
          // tech is opening now.
          props.onClearStale();
          setOpen(true);
        }}
        data-testid="add-event-open"
      >
        <Plus className="h-4 w-4" />
        Add event
      </Button>
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
    <div className="rod-addform" data-testid="add-event-form">
      <div className="rod-fields">
        <label className="field">
          <span className="field-label">What happened</span>
          <span className="select-wrap">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RoEventKind)}
              className="input select"
            >
              {PICKABLE.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </select>
            <ChevronDown size={16} className="select-chev" aria-hidden />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            required
          />
        </label>
        {/* Note/Label sits directly under "What happened" so picking Custom
            points straight at the field it turns into the label. */}
        <label className="field">
          <span className="field-label">{kind === "custom" ? "Label" : "Note"}</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === "custom" ? "e.g. Claim #4471 filed" : "optional"}
            className="input"
          />
        </label>
        <label className="field">
          <span className="field-label">Time (optional)</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="input"
          />
        </label>
      </div>
      <InlineAlert error={error} testId="add-event-error" />
      <div className="rod-addform-act">
        {/* Cancel is disabled mid-write too: unmounting the body does not
            cancel the write, so letting it close would leave the tech asking
            "did that save?" while the row lands anyway. */}
        <Button
          variant="quiet"
          size="sm"
          onClick={onDone}
          disabled={pending || busy}
        >
          Cancel
        </Button>
        <Button
          variant="go"
          size="sm"
          onClick={submit}
          disabled={pending || busy || (kind === "custom" && note.trim() === "")}
          data-testid="add-event-save"
        >
          Add event
        </Button>
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
      <Button
        block
        className="rod-open-add"
        onClick={() => {
          props.onClearStale();
          setOpen(true);
        }}
        data-testid="add-hours-open"
      >
        <Plus className="h-4 w-4" />
        Add hours for a day
      </Button>
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
    <div className="rod-addform" data-testid="add-hours-form">
      <div className="rod-fields">
        <label className="field">
          <span className="field-label">Day</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Hours</span>
          <input
            type="number"
            min={0}
            max={24}
            step={0.1}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="8.0"
            className="input num"
            data-testid="add-hours-input"
          />
        </label>
        <label className="field rod-span">
          <span className="field-label">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="teardown, looking for the cause"
            className="input"
          />
        </label>
      </div>
      {/* Hold time is not hours on the ticket — it stays in its own unpaid
          bucket. Said once, here, where the tech is typing. */}
      <p className="rod-fine">
        Hours you worked on it. Waiting on parts or approval is logged as unpaid time, not here.
      </p>
      <InlineAlert error={error} testId="add-hours-error" />
      <div className="rod-addform-act">
        <Button
          variant="quiet"
          size="sm"
          onClick={onDone}
          disabled={pending || busy}
        >
          Cancel
        </Button>
        <Button
          variant="go"
          size="sm"
          onClick={submit}
          disabled={pending || busy || hours.trim() === ""}
          data-testid="add-hours-save"
        >
          Add hours
        </Button>
      </div>
    </div>
  );
}
