"use client";

// Empty scheduled workdays awaiting a decision (schedule-based efficiency
// plan). These days are held OUT of efficiency until resolved, so a
// forgotten vacation mark can't silently tank the number — but a real slow
// day, once confirmed, honestly counts its full scheduled hours.
//
// Phase 2 adds a THIRD answer, "Worked — unpaid". The original two forced a
// lie on the most common kind of empty day in a flat-rate shop: you were there
// all day on a comeback, or waiting on parts, and flagged nothing. "Day off"
// poisons schedule inference; "Worked, zero flag" tanks the day with no record
// of why. The third option counts the day as worked (same marker as the second)
// AND writes a ledger row saying where the hours went.
import { useState, useTransition } from "react";
import { resolveZeroDayAction } from "@/app/actions/schedule";
import { formatDateLong } from "@/lib/periods";
import type { UnpaidTimeKind } from "@/lib/types";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Zone } from "@/components/ui/Zone";
import { StatusField } from "@/components/ui/StatusField";
import { FiguresInText } from "./Figures";

const SHOW_LIMIT = 5;

// The kinds that plausibly explain a whole empty scheduled day. rework_same_visit
// is deliberately absent — it happens inside a day that DID flag hours, so it
// never explains a zero day on its own.
const ZERO_DAY_REASONS: { kind: UnpaidTimeKind; label: string }[] = [
  { kind: "comeback_own", label: "Comeback — my work" },
  { kind: "comeback_other", label: "Comeback — another tech's" },
  { kind: "wait_parts", label: "Waiting on parts" },
  { kind: "wait_approval", label: "Waiting on approval" },
  { kind: "shop_time", label: "Shop time / no work dispatched" },
];

export function UnresolvedDaysCard({ days }: { days: string[] }) {
  const [remaining, setRemaining] = useState(days);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Which day (if any) has the unpaid capture form open, plus its draft.
  const [unpaidDate, setUnpaidDate] = useState<string | null>(null);
  const [unpaidHours, setUnpaidHours] = useState("");
  const [unpaidKind, setUnpaidKind] = useState<UnpaidTimeKind>("comeback_own");
  const [unpaidNote, setUnpaidNote] = useState("");

  if (remaining.length === 0) return null;

  function closeUnpaid() {
    setUnpaidDate(null);
    setUnpaidHours("");
    setUnpaidKind("comeback_own");
    setUnpaidNote("");
  }

  function resolve(date: string, resolution: "day-off" | "worked-zero") {
    setError(null);
    setBusyDate(date);
    startTransition(async () => {
      try {
        await resolveZeroDayAction(date, resolution);
        setRemaining((prev) => prev.filter((d) => d !== date));
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save — try again."));
      } finally {
        setBusyDate(null);
      }
    });
  }

  function submitUnpaid(date: string) {
    const hours = Number(unpaidHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours the day actually took.");
      return;
    }
    setError(null);
    setBusyDate(date);
    startTransition(async () => {
      try {
        await resolveZeroDayAction(date, "worked-unpaid", {
          hours,
          kind: unpaidKind,
          note: unpaidNote,
        });
        setRemaining((prev) => prev.filter((d) => d !== date));
        closeUnpaid();
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save — try again."));
      } finally {
        setBusyDate(null);
      }
    });
  }

  const shown = remaining.slice(0, SHOW_LIMIT);
  const hidden = remaining.length - shown.length;

  return (
    <Zone id="z-empty" name="Empty days">
      <StatusField tag="Note">
        <p>
          <b>
            {remaining.length === 1
              ? "One scheduled day looks empty"
              : <FiguresInText text={`${remaining.length} scheduled days look empty`} />}
          </b>
        </p>
        <p>
          No ROs or clocked hours on these workdays. They&apos;re left out of
          your efficiency until you settle them — a day off is excluded, a real
          zero counts against it, and unpaid work counts the day while recording
          where the hours went.
        </p>
      </StatusField>
      <ul className="days">
        {shown.map((date) => (
          <li key={date}>
            <div className="lead">{formatDateLong(date)}</div>
            <div className="days-act">
              <Button
                variant="quiet"
                disabled={busyDate !== null}
                onClick={() => resolve(date, "day-off")}
              >
                {busyDate === date && unpaidDate !== date ? "Saving…" : "Day off"}
              </Button>
              <Button
                variant="quiet"
                disabled={busyDate !== null}
                onClick={() => resolve(date, "worked-zero")}
              >
                Worked, zero flag
              </Button>
              <Button
                variant="quiet"
                disabled={busyDate !== null}
                aria-expanded={unpaidDate === date}
                onClick={() =>
                  unpaidDate === date ? closeUnpaid() : setUnpaidDate(date)
                }
              >
                Worked — unpaid
              </Button>
            </div>

            {unpaidDate === date && (
              <Card inset className="days-form">
                <div className="days-form-row">
                  <Field label="Hours" htmlFor={`unpaid-hours-${date}`} className="days-hours">
                    <Input
                      id={`unpaid-hours-${date}`}
                      type="number"
                      min={0}
                      max={24}
                      step={0.25}
                      inputMode="decimal"
                      value={unpaidHours}
                      onChange={(e) => setUnpaidHours(e.target.value)}
                      mono
                      placeholder="8"
                    />
                  </Field>
                  <Field label="Where the time went" htmlFor={`unpaid-kind-${date}`} className="days-kind">
                    <Select
                      id={`unpaid-kind-${date}`}
                      value={unpaidKind}
                      onChange={(e) => setUnpaidKind(e.target.value as UnpaidTimeKind)}
                    >
                      {ZERO_DAY_REASONS.map((r) => (
                        <option key={r.kind} value={r.kind}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Note (optional)" htmlFor={`unpaid-note-${date}`}>
                  <Input
                    id={`unpaid-note-${date}`}
                    type="text"
                    value={unpaidNote}
                    onChange={(e) => setUnpaidNote(e.target.value)}
                    placeholder="RO 48213 back for the same leak"
                  />
                </Field>
                <div className="days-act">
                  <Button
                    variant="go"
                    disabled={busyDate !== null}
                    onClick={() => submitUnpaid(date)}
                  >
                    {busyDate === date ? "Saving…" : "Save unpaid day"}
                  </Button>
                  <Button variant="quiet" disabled={busyDate !== null} onClick={closeUnpaid}>
                    Cancel
                  </Button>
                </div>
              </Card>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="fine days-more">…and {hidden} more once these are settled.</p>}
      {error && (
        <StatusField tag="Fix" role="alert">
          <p>{error}</p>
        </StatusField>
      )}
    </Zone>
  );
}
