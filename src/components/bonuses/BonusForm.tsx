"use client";

// Shared spiff/bonus form — used by the dashboard QuickAddModal's "Spiff" tab
// and by the pay-period Spiffs & Bonuses section (add + edit). Handles its own
// submit through the bonus server actions, then calls onSaved.
//
// Fast path by design: amount autofocuses, category defaults to "spiff", date
// defaults to today. From the dashboard that's log-a-spiff in ≤3 taps (open
// quick-add → Spiff tab → Save, with the amount typed).
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, X } from "lucide-react";
import type { Bonus, BonusCategory, NewBonus } from "@/lib/types";
import { BONUS_CATEGORIES, BONUS_CATEGORY_LABELS } from "@/lib/bonuses";
import { isoDate } from "@/lib/periods";
import { tap } from "@/lib/haptics";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { notifyDataChanged } from "@/components/layout/CrossTabRefresh";
import {
  createBonusAction,
  updateBonusAction,
  listRecentRosAction,
  type RecentRo,
} from "@/app/actions/bonuses";
import { actionErrorMessage } from "@/lib/action-error";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { StatusField } from "@/components/ui/StatusField";

export function BonusForm({
  initial,
  defaultDate,
  onSaved,
  onCancel,
  submitLabel,
}: {
  initial?: Bonus; // present = edit mode
  defaultDate?: string; // seeds the date field for new bonuses (defaults to today)
  onSaved: (bonus: Bonus) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [amount, setAmount] = useState<string>(
    initial ? String(initial.amount) : "",
  );
  const [category, setCategory] = useState<BonusCategory>(
    initial?.category ?? "spiff",
  );
  const [date, setDate] = useState<string>(
    initial?.date ?? defaultDate ?? isoDate(),
  );
  const [source, setSource] = useState<string>(initial?.source ?? "");
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [entryId, setEntryId] = useState<string | null>(initial?.entryId ?? null);

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => amountRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function handleSubmit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0 || amount.trim() === "") {
      setError("Enter a dollar amount.");
      return;
    }
    setError(null);
    const input: NewBonus = {
      date,
      amount: parsed,
      category,
      source: source.trim() || null,
      note: note.trim() || null,
      entryId,
    };
    startSaving(async () => {
      try {
        const saved =
          isEdit && initial
            ? await updateBonusAction(initial.id, input)
            : await createBonusAction(input);
        tap();
        router.refresh();
        // Same stale-tree hazard as Quick Add — see RefreshFlusher (c655c010).
        window.dispatchEvent(new Event(FLUSH_EVENT));
        notifyDataChanged(); // and the other open tabs

        onSaved(saved);
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to save."));
      }
    });
  }

  return (
    <div className="bon-form">
      {/* Amount */}
      <Field label="Amount" htmlFor="bonus-amount">
        <div className="bon-amt">
          <span aria-hidden="true">$</span>
          <input
            id="bonus-amount"
            ref={amountRef}
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="25"
            autoComplete="off"
            required
            aria-required="true"
            aria-describedby={error ? "bonus-error" : undefined}
            className="input num"
          />
        </div>
      </Field>

      {/* Category */}
      <div className="field">
        <div className="field-label">Category</div>
        <div className="fchips" role="radiogroup" aria-label="Category">
          {BONUS_CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c)}
                className="fchip bon-chip"
              >
                {BONUS_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Source + Date */}
      <div className="bon-pair">
        <Field label="Source" htmlFor="bonus-source">
          <input
            id="bonus-source"
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="tire spiff"
            autoComplete="off"
            className="input"
          />
        </Field>
        <Field label="Date" htmlFor="bonus-date">
          <input
            id="bonus-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="pill-input"
          />
        </Field>
      </div>

      {/* Optional RO link */}
      <RoLinkPicker entryId={entryId} onChange={setEntryId} />

      {/* Note */}
      <div className="field">
        <label htmlFor="bonus-note" className="field-label">
          Note <span className="bon-opt">(optional)</span>
        </label>
        <input
          id="bonus-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="anything worth remembering"
          autoComplete="off"
          className="input"
        />
      </div>

      {error && (
        <StatusField tag="Fix" role="alert" inset id="bonus-error">
          <p>{error}</p>
        </StatusField>
      )}

      <div className="dlg-foot bon-actions">
        {onCancel && (
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="go"
          onClick={handleSubmit}
          disabled={saving || !amount.trim()}
        >
          {saving ? "Saving…" : (submitLabel ?? (isEdit ? "Save changes" : "Save spiff"))}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------

// "Attach to RO" — a menu-sale spiff usually belongs to a specific job. Recent
// ROs are loaded lazily the first time the picker is opened.
function RoLinkPicker({
  entryId,
  onChange,
}: {
  entryId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ros, setRos] = useState<RecentRo[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function ensureLoaded() {
    if (ros !== null) return;
    setLoading(true);
    try {
      setRos(await listRecentRosAction());
    } catch {
      setRos([]);
    } finally {
      setLoading(false);
    }
  }

  const linked = entryId ? ros?.find((r) => r.id === entryId) : undefined;

  return (
    <div className="field">
      <div className="field-label">
        Linked RO <span className="bon-opt">(optional)</span>
      </div>
      {entryId ? (
        <div className="card-inset bon-linked">
          <span className="bon-linked-txt">
            <Link2 className="bon-ico" aria-hidden="true" />
            <span className="num bon-ro">#{linked?.roNumber ?? "linked"}</span>
            {linked?.vehicleSummary && (
              <span className="bon-veh">{linked.vehicleSummary}</span>
            )}
          </span>
          <Button
            variant="quiet"
            onClick={() => onChange(null)}
            aria-label="Unlink RO"
          >
            <X className="bon-ico" aria-hidden="true" />
          </Button>
        </div>
      ) : !open ? (
        <Button
          variant="line"
          onClick={() => {
            setOpen(true);
            void ensureLoaded();
          }}
        >
          <Link2 className="bon-ico" aria-hidden="true" />
          Attach to an RO
        </Button>
      ) : (
        <div className="card-inset bon-picker">
          <div className="bon-picker-head">
            <span>Recent ROs</span>
            <Button
              variant="quiet"
              onClick={() => setOpen(false)}
              aria-label="Close RO picker"
            >
              <X className="bon-ico" aria-hidden="true" />
            </Button>
          </div>
          <ul className="log-picks bon-picks">
            {loading ? (
              <li className="bon-empty">Loading…</li>
            ) : ros && ros.length > 0 ? (
              ros.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                    className="log-pick"
                  >
                    <span className="log-pick-txt">
                      <b className="num">#{r.roNumber}</b>
                      {r.vehicleSummary && (
                        <span className="log-pick-desc">{r.vehicleSummary}</span>
                      )}
                    </span>
                    <span className="log-pick-act num">{r.date}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="bon-empty">No recent ROs to link.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
