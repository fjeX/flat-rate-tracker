"use client";

// "Spiffs & Bonuses" section on the pay-period page. Lists the period's bonuses,
// totals them, and combines with plan-02 flag pay into a total-pay line when
// rates are priced. Spiffs are dollars natively — this renders even with no rates.
//
// Bonuses are deliberately OUT of hours reconciliation (that's flag hours only);
// the note here heads off "my check is bigger than flagged pay" confusion.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Link2, Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Bonus } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { sumBonuses, periodTotalPay, BONUS_CATEGORY_LABELS } from "@/lib/bonuses";
import { formatDateLong } from "@/lib/periods";
import { BonusForm } from "@/components/bonuses/BonusForm";
import { deleteBonusAction } from "@/app/actions/bonuses";

export function SpiffsCard({
  bonuses,
  flagPay,
  defaultDate,
}: {
  bonuses: Bonus[];
  flagPay: number | null; // period flag-pay dollars, or null when no rates priced
  defaultDate?: string; // seeds new-bonus date to the period (defaults to today in form)
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Bonus | null>(null);

  const bonusTotal = sumBonuses(bonuses);
  const totals = periodTotalPay(flagPay, bonusTotal);

  return (
    <section className="card padded space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--fg-2)]">Spiffs &amp; Bonuses</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-sm btn-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {bonuses.length === 0 ? (
        <p className="text-sm text-[var(--fg-3)]">
          No spiffs or bonuses logged this period. Log them the moment you earn
          them — they&apos;re easy to forget by payday.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--line)] rounded-md border border-[var(--line)]">
            {bonuses.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-[var(--fg-1)]">
                      {b.source?.trim() || BONUS_CATEGORY_LABELS[b.category]}
                    </span>
                    <span className="rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-3)]">
                      {BONUS_CATEGORY_LABELS[b.category]}
                    </span>
                    {b.entryId && (
                      <Link2 className="h-3 w-3 text-[var(--brand)]" aria-label="Linked to an RO" />
                    )}
                  </div>
                  <div className="text-xs text-[var(--fg-3)]">
                    {formatDateLong(b.date)}
                    {b.note ? ` · ${b.note}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm font-medium text-[var(--good)]">
                    {fmtMoney(b.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    aria-label="Edit bonus"
                    className="relative rounded p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)] after:absolute after:-inset-1.5 after:content-['']"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <DeleteButton bonusId={b.id} onDeleted={() => router.refresh()} />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-2 text-sm">
            <span className="text-[var(--fg-2)]">Spiffs total</span>
            <span className="font-mono font-medium text-[var(--good)]">
              {fmtMoney(bonusTotal)}
            </span>
          </div>

          {totals.showBreakdown && (
            <p className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-xs text-[var(--fg-2)]">
              Total pay:{" "}
              <span className="font-medium">Flag pay {fmtMoney(totals.flagPay ?? 0)}</span>
              {" + "}
              <span className="font-medium">Spiffs {fmtMoney(totals.bonusTotal)}</span>
              {" = "}
              <span className="font-semibold text-[var(--good)]">{fmtMoney(totals.total)}</span>
            </p>
          )}
        </>
      )}

      <p className="text-[11px] text-[var(--fg-3)]">
        Spiffs aren&apos;t part of hours reconciliation — they show in dollar
        totals only.
      </p>

      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add spiff / bonus">
          <BonusForm
            defaultDate={defaultDate}
            onSaved={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Edit spiff / bonus">
          <BonusForm
            initial={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </section>
  );
}

function DeleteButton({
  bonusId,
  onDeleted,
}: {
  bonusId: string;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  function handle() {
    if (!window.confirm("Delete this spiff? This can't be undone.")) return;
    start(async () => {
      try {
        await deleteBonusAction(bonusId);
        onDeleted();
      } catch {
        // Best-effort; the row stays if it fails.
      }
    });
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      aria-label="Delete bonus"
      className="relative rounded p-1 text-[var(--fg-3)] hover:text-[var(--bad)] disabled:opacity-40 after:absolute after:-inset-1.5 after:content-['']"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
