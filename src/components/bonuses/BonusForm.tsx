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
import {
  createBonusAction,
  updateBonusAction,
  listRecentRosAction,
  type RecentRo,
} from "@/app/actions/bonuses";

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
    if (!Number.isFinite(parsed) || parsed <= 0) {
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
        onSaved(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Amount */}
      <div>
        <label
          htmlFor="bonus-amount"
          className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--fg-3)]"
        >
          Amount
        </label>
        <div className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 focus-within:border-[var(--brand)]">
          <span className="text-lg font-bold text-[var(--fg-3)]" aria-hidden="true">
            $
          </span>
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
            className="flex-1 bg-transparent text-lg font-semibold text-[var(--fg-0)] placeholder-[var(--fg-3)] focus:outline-none"
          />
        </div>
      </div>

      {/* Category */}
      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-[var(--fg-3)]">
          Category
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
          {BONUS_CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  active
                    ? "border-[var(--brand)] bg-[var(--brand-bg)] text-[var(--brand)]"
                    : "border-[var(--line)] bg-[var(--bg-3)] text-[var(--fg-2)] hover:border-[var(--brand-soft)]"
                }`}
              >
                {BONUS_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Source + Date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="bonus-source"
            className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--fg-3)]"
          >
            Source
          </label>
          <input
            id="bonus-source"
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="tire spiff"
            autoComplete="off"
            className="input text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="bonus-date"
            className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--fg-3)]"
          >
            Date
          </label>
          <input
            id="bonus-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input text-sm"
          />
        </div>
      </div>

      {/* Optional RO link */}
      <RoLinkPicker entryId={entryId} onChange={setEntryId} />

      {/* Note */}
      <div>
        <label
          htmlFor="bonus-note"
          className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--fg-3)]"
        >
          Note <span className="text-[var(--fg-3)]">(optional)</span>
        </label>
        <input
          id="bonus-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="anything worth remembering"
          autoComplete="off"
          className="input text-sm"
        />
      </div>

      {error && (
        <p id="bonus-error" role="alert" className="text-sm text-[var(--bad)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !amount.trim()}
          className="btn btn-primary"
        >
          {saving ? "Saving…" : (submitLabel ?? (isEdit ? "Save changes" : "Save spiff"))}
        </button>
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
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
        Linked RO <span className="text-[var(--fg-3)]">(optional)</span>
      </div>
      {entryId ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 min-w-0">
            <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-[var(--brand)]" />
            <span className="font-mono text-[var(--brand)]">
              #{linked?.roNumber ?? "linked"}
            </span>
            {linked?.vehicleSummary && (
              <span className="truncate text-xs text-[var(--fg-3)]">
                {linked.vehicleSummary}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Unlink RO"
            className="relative text-[var(--fg-3)] hover:text-[var(--bad)] after:absolute after:-inset-2 after:content-['']"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : !open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            void ensureLoaded();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--line)] py-2 text-xs text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)]"
        >
          <Link2 className="h-3.5 w-3.5" />
          Attach to an RO
        </button>
      ) : (
        <div className="rounded-md border border-[var(--line)] bg-[var(--bg-2)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-3)]">
            <span>Recent ROs</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close RO picker"
              className="relative hover:text-[var(--fg-1)] after:absolute after:-inset-2 after:content-['']"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-40 overflow-y-auto">
            {loading ? (
              <li className="px-3 py-2 text-xs text-[var(--fg-3)]">Loading…</li>
            ) : ros && ros.length > 0 ? (
              ros.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-3)]"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-sm text-[var(--brand)]">
                        #{r.roNumber}
                      </span>
                      {r.vehicleSummary && (
                        <span className="ml-2 truncate text-xs text-[var(--fg-3)]">
                          {r.vehicleSummary}
                        </span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-xs text-[var(--fg-3)]">
                      {r.date}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-xs text-[var(--fg-3)]">
                No recent ROs to link.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
