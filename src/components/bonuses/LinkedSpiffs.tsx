"use client";

// Read-only list of spiffs/bonuses linked to one RO, shown in RoDetailModal.
// A menu-sale spiff usually belongs to a specific job, so surfacing it on the RO
// closes the loop — the money and the work that earned it live in one place.
import { useEffect, useState } from "react";
import { BadgeDollarSign } from "lucide-react";
import type { Bonus } from "@/lib/types";
import { fmtMoney } from "@/lib/earnings";
import { BONUS_CATEGORY_LABELS } from "@/lib/bonuses";
import { listBonusesForEntryAction } from "@/app/actions/bonuses";

export function LinkedSpiffs({ entryId }: { entryId: string }) {
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBonusesForEntryAction(entryId);
        if (!cancelled) setBonuses(list);
      } catch {
        // Non-fatal — the section just won't render.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  // Nothing linked (or still loading first paint) → render nothing, keep the
  // modal uncluttered.
  if (!loaded || bonuses.length === 0) return null;

  return (
    <div className="card-inset rod-well">
      <div className="rod-well-head">
        <h3 className="field-label rod-well-name">
          <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />
          Linked spiffs
          <span className="rod-count">({bonuses.length})</span>
        </h3>
      </div>
      <ul className="rod-rule">
        {bonuses.map((b) => (
          <li key={b.id}>
            <span className="rod-main">
              {b.source?.trim() || BONUS_CATEGORY_LABELS[b.category]}
              <span className="rod-kind">
                {BONUS_CATEGORY_LABELS[b.category]}
              </span>
            </span>
            <span className="rod-fig rod-fig-good">
              {fmtMoney(b.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
