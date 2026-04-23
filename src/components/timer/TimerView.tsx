"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RotateCcw, Save, X } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  pauseTimerAction,
  resetTimerAction,
  setTimerRoAction,
  startTimerAction,
} from "@/app/actions/timer";
import { TimerSaveModal } from "./TimerSaveModal";

type TimerState = {
  roId: string | null;
  startTime: number | null;
  accumulated: number;
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimerView({
  initialTimer,
  attachedEntry,
  recentEntries,
  library,
}: {
  initialTimer: TimerState;
  attachedEntry: Entry | null;
  recentEntries: Entry[];
  library: OpCode[];
}) {
  const router = useRouter();
  const running = initialTimer.startTime !== null;
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  // Tick once a second while running so the digital display updates.
  // We re-read `Date.now()` every tick and derive elapsed from the server-
  // authoritative startTime, so drift is bounded and refresh is accurate.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedMs =
    initialTimer.accumulated +
    (initialTimer.startTime !== null
      ? Math.max(0, now - initialTimer.startTime)
      : 0);
  const status: "READY" | "RUNNING" | "PAUSED" = running
    ? "RUNNING"
    : elapsedMs > 0
    ? "PAUSED"
    : "READY";

  function run(action: () => Promise<void>) {
    setError(null);
    startPending(async () => {
      try {
        await action();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed.");
      }
    });
  }

  function handleReset() {
    if (
      elapsedMs > 0 &&
      !window.confirm(
        `Reset the timer? ${formatElapsed(elapsedMs)} will be discarded.`,
      )
    ) {
      return;
    }
    run(() => resetTimerAction());
  }

  function handleClearRo() {
    run(() => setTimerRoAction(null));
  }

  function handlePickRo(roId: string) {
    run(() => setTimerRoAction(roId));
  }

  const canSave = attachedEntry !== null && elapsedMs > 0;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <h1 className="text-xl font-semibold">Timer</h1>

      <div className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 text-center">
        <StatusBadge status={status} />
        <div className="mt-3 font-mono text-5xl font-semibold tabular-nums text-zinc-100 sm:text-6xl">
          {formatElapsed(elapsedMs)}
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={() => run(() => pauseTimerAction())}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run(() => startTimerAction())}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {status === "PAUSED" ? "Resume" : "Start"}
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={pending || status === "READY"}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-300">{error}</p>
        )}
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          Attached RO
        </h2>
        {attachedEntry ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-orange-400">
                  #{attachedEntry.roNumber}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatDateShort(attachedEntry.date)}
                </span>
              </div>
              <VehicleLine entry={attachedEntry} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                disabled={!canSave || pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
                title={
                  !canSave && elapsedMs === 0
                    ? "Start the timer first"
                    : undefined
                }
              >
                <Save className="h-4 w-4" />
                Save to Job
              </button>
              <button
                type="button"
                onClick={handleClearRo}
                disabled={pending}
                className="rounded-md border border-zinc-800 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                aria-label="Clear attached RO"
                title="Clear attached RO"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            No RO attached. Pick one from the list below to track time against
            it.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Recent ROs</h2>
        <RecentRoList
          entries={recentEntries}
          attachedId={attachedEntry?.id ?? null}
          disabled={pending}
          onPick={handlePickRo}
        />
      </section>

      {saveOpen && attachedEntry && (
        <TimerSaveModal
          entry={attachedEntry}
          library={library}
          elapsedMs={elapsedMs}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: "READY" | "RUNNING" | "PAUSED" }) {
  const styles: Record<typeof status, string> = {
    READY: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    RUNNING: "border-green-700/60 bg-green-950/60 text-green-300",
    PAUSED: "border-amber-700/60 bg-amber-950/60 text-amber-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[status]}`}
    >
      {status === "RUNNING" && (
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
        </span>
      )}
      {status}
    </span>
  );
}

function VehicleLine({ entry }: { entry: Entry }) {
  const label = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!label) return null;
  return (
    <div className="mt-0.5 truncate text-xs text-zinc-400">{label}</div>
  );
}

function RecentRoList({
  entries,
  attachedId,
  disabled,
  onPick,
}: {
  entries: Entry[];
  attachedId: string | null;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p className="text-sm text-zinc-400">No ROs yet. Log one first.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
      {entries.map((e) => {
        const isAttached = e.id === attachedId;
        const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
          .filter(Boolean)
          .join(" ")
          .trim();
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onPick(e.id)}
              disabled={disabled || isAttached}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/60 disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-orange-400">
                    #{e.roNumber}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDateShort(e.date)}
                  </span>
                  {isAttached && (
                    <span className="rounded-full border border-orange-700/60 bg-orange-950/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-orange-300">
                      Attached
                    </span>
                  )}
                </div>
                {vehicle && (
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {vehicle}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-sm font-medium text-zinc-100">
                {fmtHours(e.flagHours)}h
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
