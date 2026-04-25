"use client";

import { useState, useTransition } from "react";
import type { Stats } from "@/lib/stats";
import { fmtHours } from "@/lib/stats";
import { setPaidPeriodHoursAction } from "@/app/actions/paid-periods";

const TOLERANCE = 0.1;

type Verdict = "missing" | "over" | "match" | "unknown";

function toText(n: number | null): string {
  return n === null ? "" : String(n);
}

function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function verdictFor(paid: number | null, logged: number): Verdict {
  if (paid === null) return "unknown";
  const diff = paid - logged;
  if (Math.abs(diff) <= TOLERANCE) return "match";
  return diff < 0 ? "missing" : "over";
}

export function DiscrepancyCard({
  periodKey,
  stats,
  initialPaid,
}: {
  periodKey: string;
  stats: Stats;
  initialPaid: number | null;
}) {
  const [paidText, setPaidText] = useState<string>(toText(initialPaid));
  const [savedPaid, setSavedPaid] = useState<number | null>(initialPaid);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsedPaid = parseHours(paidText);
  const logged = stats.flagHours;
  const verdict = verdictFor(parsedPaid, logged);
  const dirty = parsedPaid !== null && parsedPaid !== savedPaid;

  function commit() {
    if (!dirty || parsedPaid === null) return;
    setError(null);
    const value = parsedPaid;
    startTransition(async () => {
      try {
        await setPaidPeriodHoursAction(periodKey, value);
        setSavedPaid(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  const diff = parsedPaid === null ? null : parsedPaid - logged;

  const diffColor =
    verdict === "missing"
      ? "text-red-400"
      : verdict === "over"
        ? "text-yellow-400"
        : verdict === "match"
          ? "text-green-400"
          : "text-zinc-500";

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-sm font-medium text-zinc-100">
        Pay Discrepancy Check
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            Actual paid flag hrs
          </span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={paidText}
            onChange={(e) => setPaidText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-lg font-semibold focus:border-orange-500 focus:outline-none"
          />
        </label>
        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Logged flag hrs
          </div>
          <div className="mt-1 text-lg font-semibold text-zinc-300">
            {fmtHours(logged)}h
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Difference
          </div>
          <div className={`mt-1 text-lg font-semibold ${diffColor}`}>
            {diff === null
              ? "—"
              : `${diff > 0 ? "+" : ""}${fmtHours(diff)}h`}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
      {!error && isPending && (
        <p className="text-xs text-zinc-500">Saving…</p>
      )}
      {!error && !isPending && dirty && (
        <p className="text-xs text-zinc-500">
          Press enter or click away to save
        </p>
      )}

      {verdict === "missing" && diff !== null && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          Missing {fmtHours(-diff)} hours. Review the RO list below — use the
          logged ROs as proof when you talk to your service manager.
        </div>
      )}
    </section>
  );
}
