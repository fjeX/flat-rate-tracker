"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Save, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { fmtHours } from "@/lib/stats";
import { formatDateShort } from "@/lib/periods";
import type { Entry, EntryOpCode } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

// ── Main component ────────────────────────────────────────────────────────────

export function GuestTimerView() {
  const {
    entries,
    opCodes,
    timerState,
    startGuestTimer,
    pauseGuestTimer,
    resetGuestTimer,
    setGuestTimerRo,
    updateEntryHours,
  } = useGuestStore();

  const [now, setNow] = useState<number>(() => Date.now());
  const [linePickEntry, setLinePickEntry] = useState<Entry | null>(null);
  const [saveConfirming, setSaveConfirming] = useState(false);

  const running = timerState.startTime !== null;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedMs =
    timerState.accumulated +
    (timerState.startTime !== null
      ? Math.max(0, now - timerState.startTime)
      : 0);

  const status: "READY" | "RUNNING" | "PAUSED" = running
    ? "RUNNING"
    : elapsedMs > 0
    ? "PAUSED"
    : "READY";

  const opCodesById = useMemo(
    () => new Map(opCodes.map((oc) => [oc.id, oc])),
    [opCodes],
  );

  function getLineLabel(line: EntryOpCode): { code: string; description: string } {
    if (line.custom) {
      return {
        code: (line.customCode ?? "").trim() || "—",
        description: (line.customDescription ?? "").trim(),
      };
    }
    const ref = line.opCodeId ? opCodesById.get(line.opCodeId) : undefined;
    return { code: ref?.code ?? "—", description: ref?.description ?? "" };
  }

  function handleReset() {
    if (
      elapsedMs > 0 &&
      !window.confirm(`Reset the timer? ${formatElapsed(elapsedMs)} will be discarded.`)
    ) {
      return;
    }
    setSaveConfirming(false);
    resetGuestTimer();
  }

  function handlePickEntry(entry: Entry) {
    if (entry.opCodes.length > 1) {
      setLinePickEntry(entry);
    } else {
      setGuestTimerRo(entry.id, entry.opCodes[0]?.id ?? null);
    }
  }

  function handleLineConfirm(lineId: string, entry: Entry) {
    setGuestTimerRo(entry.id, lineId);
    setLinePickEntry(null);
  }

  function handleClearRo() {
    setSaveConfirming(false);
    setGuestTimerRo(null, null);
  }

  function handleConfirmSave() {
    if (!timerState.roId || !timerState.lineId) return;
    const actualHours = Math.round((elapsedMs / 3_600_000) * 100) / 100;
    updateEntryHours(timerState.roId, timerState.lineId, actualHours);
    resetGuestTimer();
    setSaveConfirming(false);
  }

  const attachedEntry = timerState.roId
    ? (entries.find((e) => e.id === timerState.roId) ?? null)
    : null;

  const selectedLine =
    timerState.lineId && attachedEntry
      ? (attachedEntry.opCodes.find((l) => l.id === timerState.lineId) ?? null)
      : null;

  const canSave = attachedEntry !== null && timerState.lineId !== null && elapsedMs > 0;

  const recentEntries = entries.slice(0, 10);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <h1 className="text-xl font-semibold">Timer</h1>

      {/* Timer card */}
      <div className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 text-center">
        <StatusBadge status={status} />
        <div className="mt-3 font-mono text-5xl font-semibold tabular-nums text-zinc-100 sm:text-6xl">
          {formatElapsed(elapsedMs)}
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={pauseGuestTimer}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={startGuestTimer}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
            >
              <Play className="h-4 w-4" />
              {status === "PAUSED" ? "Resume" : "Start"}
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={status === "READY"}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Attached RO */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">Attached RO</h2>

        {attachedEntry ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-start justify-between gap-3">
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

                {/* Line selection */}
                {attachedEntry.opCodes.length > 1 && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    <span className="text-zinc-500">Line:</span>
                    {selectedLine ? (
                      <>
                        <span className="font-mono text-orange-300">
                          {getLineLabel(selectedLine).code}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLinePickEntry(attachedEntry)}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          Change
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLinePickEntry(attachedEntry)}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        Pick a line →
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSaveConfirming(true)}
                  disabled={!canSave}
                  className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
                  title={!canSave ? "Start the timer first and pick a line" : undefined}
                >
                  <Save className="h-4 w-4" />
                  Save to Job
                </button>
                <button
                  type="button"
                  onClick={handleClearRo}
                  className="rounded-md border border-zinc-800 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  aria-label="Clear attached RO"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Inline save confirmation */}
            {saveConfirming && (
              <div className="rounded-lg border border-orange-700/40 bg-orange-950/20 px-4 py-3">
                <p className="text-sm text-zinc-200">
                  Saving{" "}
                  <span className="font-mono font-medium text-orange-300">
                    {(Math.round((elapsedMs / 3_600_000) * 100) / 100).toFixed(2)} hrs
                  </span>{" "}
                  to RO{" "}
                  <span className="font-mono text-orange-300">
                    #{attachedEntry.roNumber}
                  </span>
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmSave}
                    className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-500"
                  >
                    Confirm Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaveConfirming(false)}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            No RO attached. Pick one from the list below.
          </p>
        )}
      </section>

      {/* Recent ROs */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Recent ROs</h2>

        {recentEntries.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <p className="text-sm text-zinc-400">No ROs yet. Log one first.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
            {recentEntries.map((entry) => {
              const isAttached = entry.id === timerState.roId;
              const vehicle = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
                .filter(Boolean)
                .join(" ")
                .trim();
              const isLinePicking = linePickEntry?.id === entry.id;

              return (
                <li key={entry.id}>
                  <div
                    role={isAttached ? undefined : "button"}
                    tabIndex={isAttached ? undefined : 0}
                    onClick={() => !isAttached && handlePickEntry(entry)}
                    onKeyDown={(ev) =>
                      ev.key === "Enter" && !isAttached && handlePickEntry(entry)
                    }
                    className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                      isAttached
                        ? "cursor-default bg-orange-950/20"
                        : "cursor-pointer hover:bg-zinc-800/60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-orange-400">
                          #{entry.roNumber}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatDateShort(entry.date)}
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
                      {fmtHours(entry.flagHours)}h
                    </span>
                  </div>

                  {/* Inline line picker */}
                  {isLinePicking && (
                    <div className="border-t border-zinc-800 bg-zinc-800/30 px-4 py-2">
                      <p className="mb-1.5 text-xs text-zinc-400">
                        Which line do you want to track time for?
                      </p>
                      <ul className="space-y-1">
                        {entry.opCodes.map((line) => {
                          const { code, description } = getLineLabel(line);
                          return (
                            <li key={line.id}>
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  handleLineConfirm(line.id, entry);
                                }}
                                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-zinc-700/50"
                              >
                                <div className="min-w-0">
                                  <span className="font-mono text-sm text-orange-400">
                                    {code}
                                  </span>
                                  {line.custom && (
                                    <span className="ml-2 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                                      Other
                                    </span>
                                  )}
                                  {description && (
                                    <div className="truncate text-xs text-zinc-500">
                                      {description}
                                    </div>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs text-zinc-400">
                                  {fmtHours(line.flagHours)}h
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setLinePickEntry(null);
                        }}
                        className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VehicleLine({ entry }: { entry: Entry }) {
  const label = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!label) return null;
  return <div className="mt-0.5 truncate text-xs text-zinc-400">{label}</div>;
}
