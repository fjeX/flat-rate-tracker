"use client";

// "Spiffs & Bonuses" section on the pay-period page. Lists the period's bonuses,
// totals them, and combines with plan-02 flag pay into a total-pay line when
// rates are priced. Spiffs are dollars natively — this renders even with no rates.
//
// Bonuses are deliberately OUT of hours reconciliation (that's flag hours only);
// the note here heads off "my check is bigger than flagged pay" confusion.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Link2, Pencil, Trash2 } from "lucide-react";
import { InfoBubble } from "@/components/ui/InfoBubble";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type { Bonus } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { sumBonuses, periodTotalPay, BONUS_CATEGORY_LABELS } from "@/lib/bonuses";
import { formatDateLong } from "@/lib/periods";
import { BonusForm } from "@/components/bonuses/BonusForm";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { notifyDataChanged } from "@/components/layout/CrossTabRefresh";
import { reportError } from "@/lib/report-error";
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
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Bonus | null>(null);

  const bonusTotal = sumBonuses(bonuses);
  const totals = periodTotalPay(flagPay, bonusTotal);

  return (
    <section className="card padded space-y-3">
      <div className="card-head-row">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] flex-1 items-center justify-between gap-2 text-left"
      >
        <h2 className="text-sm font-medium text-[var(--fg-2)]">Spiffs &amp; Bonuses</h2>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && bonuses.length > 0 && (
            <span className="font-mono text-sm font-medium tabular-nums text-[var(--good)]">
              {fmtMoney(bonusTotal)}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      <InfoBubble title="Spiffs & Bonuses">
        <p>
          Money you earned this period that did not come from flag hours —
          tire sales, alignments, battery or wiper spiffs, a monthly CSI bonus,
          anything your shop pays on top of the labour rate.
        </p>
        <h3>Why log it here</h3>
        <p>
          Spiffs are part of your pay, so leaving them out makes you look like
          you earn less than you do. They are added into your total pay when
          your effective hourly is worked out, which is the number that answers
          &ldquo;what am I really making per hour I am at the shop?&rdquo;
        </p>
        <h3>They are kept separate from flag pay on purpose</h3>
        <p>
          Your efficiency and flag hours never change when you add a spiff — a
          $60 tire bonus is not two hours of flagged work. Keeping the two apart
          means you can see how much of your pay depends on production and how
          much comes from selling, which is worth knowing before you accept a
          change to your pay plan.
        </p>
      </InfoBubble>
      </div>

      {open && (
      <div className="space-y-3 border-t border-[var(--line)] pt-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-sm btn-ghost min-h-11"
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
          <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
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
                    <Badge>
                      {BONUS_CATEGORY_LABELS[b.category]}
                    </Badge>
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
                    className="relative rounded-full p-1 text-[var(--fg-3)] transition-transform hover:text-[var(--fg-1)] active:scale-[0.96] after:absolute after:-inset-1.5 after:content-['']"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <DeleteButton
                    bonus={b}
                    onDeleted={() => {
                      router.refresh();
                      // Same stale-tree hazard as adding one — see RefreshFlusher
                      // (c655c010). Without this the row stays on screen after a
                      // successful delete, which reads as "delete didn't work".
                      window.dispatchEvent(new Event(FLUSH_EVENT));
                      notifyDataChanged(); // and the other open tabs
                    }}
                  />
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
            <p className="card-inset px-3 py-2 text-xs text-[var(--fg-2)]">
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

      <p className="text-xs text-[var(--fg-3)]">
        Spiffs aren&apos;t part of hours reconciliation — they show in dollar
        totals only.
      </p>
      </div>
      )}

      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add spiff / bonus">
          <BonusForm
            defaultDate={defaultDate}
            // Close first, then refresh from here — the card stays mounted, so
            // the refresh can't be dropped by BonusForm unmounting mid-transition
            // (which left the new spiff invisible until a full reload).
            onSaved={() => { setAdding(false); router.refresh(); }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Edit spiff / bonus">
          <BonusForm
            initial={editing}
            onSaved={() => { setEditing(null); router.refresh(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </section>
  );
}

function DeleteButton({
  bonus,
  onDeleted,
}: {
  bonus: Bonus;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  function handle() {
    // Name the row. A confirm that says "this spiff" protects nobody: on
    // 2026-08-19 an automated run clicked a positional selector, answered this
    // dialog, and hard-deleted a real $35 spiff that no backup could return.
    // Same three fields the list row shows — source, amount, date — so the
    // sentence describes something the reader can see on screen.
    const source = bonus.source?.trim();
    const bits = [
      source ? `"${source}"` : null,
      Number.isFinite(bonus.amount) ? fmtMoney(bonus.amount) : null,
      // formatDateLong assumes "YYYY-MM-DD"; anything else would print
      // "undefined undefined, NaN", so drop the clause instead.
      /^\d{4}-\d{2}-\d{2}$/.test(bonus.date) ? formatDateLong(bonus.date) : null,
    ].filter(Boolean);
    const what = bits.length > 0 ? `this spiff — ${bits.join(", ")}` : "this spiff";
    if (!window.confirm(`Delete ${what}? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteBonusAction(bonus.id);
        onDeleted();
      } catch (err) {
        // Deleting money is destructive and irreversible: a failure that only
        // leaves the row sitting there is indistinguishable from a success that
        // didn't repaint, so say so out loud and record it.
        void reportError(err, { url: "SpiffsCard/deleteBonus" });
        window.alert(
          err instanceof Error ? err.message : "Failed to delete spiff.",
        );
      }
    });
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      aria-label="Delete bonus"
      className="relative rounded-full p-1 text-[var(--fg-3)] transition-transform hover:text-[var(--bad)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 after:absolute after:-inset-1.5 after:content-['']"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
