"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Save, X } from "lucide-react";
import { useGuestStore } from "@/lib/guest/context";
import { fmtHours } from "@/lib/stats";
import { formatDateShort } from "@/lib/periods";
import type { Entry, EntryOpCode } from "@/lib/types";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { tap } from "@/lib/haptics";

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
    READY: "border-[var(--line)] bg-[var(--bg-3)] text-[var(--fg-2)]",
    RUNNING: "border-[var(--good)]/30 bg-[var(--good-bg)] text-[var(--good)]",
    PAUSED: "border-[var(--warn)]/30 bg-[var(--warn-bg)] text-[var(--warn)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[status]}`}
    >
      {status === "RUNNING" && (
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--good)] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--good)]" />
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
    tap();
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
      <div className="card p-6 text-center">
        <StatusBadge status={status} />
        <RollingNumber
          value={formatElapsed(elapsedMs)}
          className="mt-3 text-5xl font-semibold text-[var(--fg-0)] sm:text-6xl"
        />
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={() => { tap(); pauseGuestTimer(); }}
              className="btn btn-primary"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { tap(); startGuestTimer(); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--good-strong)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              <Play className="h-4 w-4" />
              {status === "PAUSED" ? "Resume" : "Start"}
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={status === "READY"}
            className="btn"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Attached RO */}
      <section className="card p-4">
        <h2 className="text-xs uppercase tracking-wide text-[var(--fg-3)]">Attached RO</h2>

        {attachedEntry ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-[var(--brand)]">
                    #{attachedEntry.roNumber}
                  </span>
                  <span className="text-xs text-[var(--fg-3)]">
                    {formatDateShort(attachedEntry.date)}
                  </span>
                </div>
                <VehicleLine entry={attachedEntry} />

                {/* Line selection */}
                {attachedEntry.opCodes.length > 1 && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--fg-3)]">Line:</span>
                    {selectedLine ? (
                      <>
                        <span className="font-mono text-[var(--brand)]">
                          {getLineLabel(selectedLine).code}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLinePickEntry(attachedEntry)}
                          className="text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                        >
                          Change
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLinePickEntry(attachedEntry)}
                        className="text-[var(--fg-2)] hover:text-[var(--fg-1)]"
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
                  className="btn btn-primary"
                  title={!canSave ? "Start the timer first and pick a line" : undefined}
                >
                  <Save className="h-4 w-4" />
                  Save to Job
                </button>
                <button
                  type="button"
                  onClick={handleClearRo}
                  className="rounded-md border border-[var(--line)] p-2 text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)]"
                  aria-label="Clear attached RO"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Inline save confirmation */}
            {saveConfirming && (
              <div className="rounded-lg border border-[var(--brand-soft)] bg-[var(--brand-bg)] px-4 py-3">
                <p className="text-sm text-[var(--fg-1)]">
                  Saving{" "}
                  <span className="font-mono font-medium text-[var(--brand)]">
                    {(Math.round((elapsedMs / 3_600_000) * 100) / 100).toFixed(2)} hrs
                  </span>{" "}
                  to RO{" "}
                  <span className="font-mono text-[var(--brand)]">
                    #{attachedEntry.roNumber}
                  </span>
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmSave}
                    className="btn btn-primary btn-sm"
                  >
                    Confirm Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaveConfirming(false)}
                    className="btn btn-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--fg-2)]">
            No RO attached. Pick one from the list below.
          </p>
        )}
      </section>

      {/* Recent ROs */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--fg-2)]">Recent ROs</h2>

        {recentEntries.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--fg-2)]">The timer clocks against an RO — log one first.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-[var(--line-soft)]">
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
                        ? "cursor-default bg-[var(--brand-bg)]"
                        : "cursor-pointer hover:bg-[var(--bg-3)]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-[var(--brand)]">
                          #{entry.roNumber}
                        </span>
                        <span className="text-xs text-[var(--fg-3)]">
                          {formatDateShort(entry.date)}
                        </span>
                        {isAttached && (
                          <span className="pill brand uppercase tracking-wide text-[10px]">
                            Attached
                          </span>
                        )}
                      </div>
                      {vehicle && (
                        <div className="mt-0.5 truncate text-xs text-[var(--fg-2)]">
                          {vehicle}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-medium text-[var(--fg-0)]">
                      {fmtHours(entry.flagHours)}h
                    </span>
                  </div>

                  {/* Inline line picker */}
                  {isLinePicking && (
                    <div className="border-t border-[var(--line)] bg-[var(--bg-3)]/30 px-4 py-2">
                      <p className="mb-1.5 text-xs text-[var(--fg-2)]">
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
                                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-4)]/50"
                              >
                                <div className="min-w-0">
                                  <span className="font-mono text-sm text-[var(--brand)]">
                                    {code}
                                  </span>
                                  {line.custom && (
                                    <span className="ml-2 rounded bg-[var(--bg-4)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-2)]">
                                      Other
                                    </span>
                                  )}
                                  {description && (
                                    <div className="truncate text-xs text-[var(--fg-3)]">
                                      {description}
                                    </div>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs text-[var(--fg-2)]">
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
                        className="mt-2 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)]"
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
  return <div className="mt-0.5 truncate text-xs text-[var(--fg-2)]">{label}</div>;
}
