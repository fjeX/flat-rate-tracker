"use client";

// Read-only list of spiffs/bonuses linked to one RO, shown in RoDetailModal.
// A menu-sale spiff usually belongs to a specific job, so surfacing it on the RO
// closes the loop — the money and the work that earned it live in one place.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
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
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
        <Sparkles className="h-3.5 w-3.5" />
        Linked spiffs
        <span className="text-[var(--fg-2)]">({bonuses.length})</span>
      </div>
      <ul className="space-y-1.5">
        {bonuses.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-[var(--fg-1)]">
              {b.source?.trim() || BONUS_CATEGORY_LABELS[b.category]}
              <span className="ml-1.5 text-xs text-[var(--fg-3)]">
                {BONUS_CATEGORY_LABELS[b.category]}
              </span>
            </span>
            <span className="font-mono font-medium text-[var(--good)]">
              {fmtMoney(b.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
