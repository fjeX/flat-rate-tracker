"use client";

// "Spiffs & Bonuses" section on the pay-period page. Lists the period's bonuses,
// totals them, and combines with plan-02 flag pay into a total-pay line when
// rates are priced. Spiffs are dollars natively — this renders even with no rates.
//
// Bonuses are deliberately OUT of hours reconciliation (that's flag hours only);
// the note here heads off "my check is bigger than flagged pay" confusion.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InfoBubble } from "@/components/ui/InfoBubble";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { withPt } from "@/components/ui/Figure";
import type { Bonus } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { sumBonuses, periodTotalPay, BONUS_CATEGORY_LABELS } from "@/lib/bonuses";
import { formatDateLong } from "@/lib/periods";
import { BonusForm } from "@/components/bonuses/BonusForm";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { notifyDataChanged } from "@/components/layout/CrossTabRefresh";
import { reportError } from "@/lib/report-error";
import { deleteBonusAction } from "@/app/actions/bonuses";
import { actionErrorMessage } from "@/lib/action-error";
import { Fold, N, PpIcon } from "./PpParts";
import { StatusField } from "@/components/ui/StatusField";

// One sentence that names a row, shared by the confirm dialog AND the two icon
// buttons' aria-labels. It lives in one place on purpose: on 2026-08-19 the
// wrong $35 spiff was deleted, def8958 fixed the dialogs, and the labels a
// script or screen reader SELECTS BY were left generic — so the two halves
// disagreed about which row was which. They can't drift if there's one copy.
//
// Returns null when nothing survives validation, so callers can fall back to
// their generic string instead of announcing "undefined".
function describeBonus(bonus: Bonus): string | null {
  const source = bonus.source?.trim();
  const bits = [
    source ? `"${source}"` : null,
    Number.isFinite(bonus.amount) ? fmtMoney(bonus.amount) : null,
    // formatDateLong indexes MONTHS_SHORT[m - 1] with no bounds check, so a
    // month outside 1-12 prints the literal "undefined" (e.g. "2026-13-45"
    // gives "undefined 45, 2026"). Shape alone isn't enough — range-check the
    // month and day so the clause is dropped rather than announced broken.
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(bonus.date)
      ? formatDateLong(bonus.date)
      : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(", ") : null;
}

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
    <>
    <Fold
      id="pp-fold-spiffs"
      title="Spiffs & Bonuses"
      state={bonuses.length > 0 ? <N v={fmtMoney(bonusTotal)} /> : undefined}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      info={
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
      }
    >
      <div className="pp-stack">
      {bonuses.length === 0 ? (
        <p className="pp-sub">
          No spiffs or bonuses logged this period. Log them the moment you earn
          them — they&apos;re easy to forget by payday.
        </p>
      ) : (
        <>
          <ul className="pp-lines">
            {bonuses.map((b) => {
              const desc = describeBonus(b);
              return (
              <li key={b.id}>
                <span className="pp-line-main">
                  <span className="pp-line-title">
                    {b.source?.trim() || BONUS_CATEGORY_LABELS[b.category]}
                    {" "}
                    <Badge chip>
                      {BONUS_CATEGORY_LABELS[b.category]}
                    </Badge>
                    {b.entryId && (
                      <span
                        className="pp-linked"
                        role="img"
                        aria-label="Linked to an RO"
                      >
                        <PpIcon name="link" />
                      </span>
                    )}
                  </span>
                  <span className="pp-line-sub">
                    {formatDateLong(b.date)}
                    {b.note ? ` · ${b.note}` : ""}
                  </span>
                </span>
                <span className="pp-line-end">
                  <span className="num">{withPt(fmtMoney(b.amount))}</span>
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    // Every row's pencil announced "Edit bonus" — identical
                    // names across a list is how you end up editing row 3
                    // while looking at row 1.
                    aria-label={desc ? `Edit bonus — ${desc}` : "Edit bonus"}
                    className="iconbtn"
                  >
                    <PpIcon name="pencil" />
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
                </span>
              </li>
              );
            })}
          </ul>

          <div className="pp-total">
            <span className="pp-lead">Spiffs total</span>
            <span className="num">{withPt(fmtMoney(bonusTotal))}</span>
          </div>

          {totals.showBreakdown && (
            <StatusField tag="Note"><p>
              Total pay:{" "}
              <span className="pp-strong">Flag pay <N v={fmtMoney(totals.flagPay ?? 0)} /></span>
              {" + "}
              <span className="pp-strong">Spiffs <N v={fmtMoney(totals.bonusTotal)} /></span>
              {" = "}
              <N v={fmtMoney(totals.total)} />
            </p></StatusField>
          )}
        </>
      )}

      <div className="pp-btnrow">
        <Button variant="line" onClick={() => setAdding(true)}>
          <PpIcon name="plus" />
          Add spiff / bonus
        </Button>
      </div>

      <p className="pp-fine">
        Spiffs aren&apos;t part of hours reconciliation — they show in dollar
        totals only.
      </p>
      </div>
    </Fold>

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
    </>
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
  const desc = describeBonus(bonus);
  function handle() {
    // Name the row. A confirm that says "this spiff" protects nobody: on
    // 2026-08-19 an automated run clicked a positional selector, answered this
    // dialog, and hard-deleted a real $35 spiff that no backup could return.
    // Same three fields the list row shows — source, amount, date — so the
    // sentence describes something the reader can see on screen.
    const what = desc ? `this spiff — ${desc}` : "this spiff";
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
          actionErrorMessage(err, "Failed to delete spiff."),
        );
      }
    });
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      // The dialog is the last line of defence; this label is the targeting.
      // Both name the same row from the same helper so they can't disagree.
      aria-label={desc ? `Delete bonus — ${desc}` : "Delete bonus"}
      className="iconbtn pp-del"
    >
      <PpIcon name="trash" />
    </button>
  );
}
