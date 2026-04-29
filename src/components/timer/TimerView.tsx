"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Plus, RotateCcw, Save, X } from "lucide-react";
import type {
  Entry,
  EntryOpCode,
  NewEntry,
  OpCode,
  RoTemplate,
} from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import {
  pauseTimerAction,
  resetTimerAction,
  setTimerRoAction,
  startTimerAction,
} from "@/app/actions/timer";
import { saveEntry } from "@/app/actions/entries";
import { TimerSaveModal } from "./TimerSaveModal";
import { RoDetailModal } from "@/components/ro/RoDetailModal";
import { Modal } from "@/components/ui/Modal";
import { LogRoForm } from "@/components/forms/LogRoForm";

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
  roTemplates,
}: {
  initialTimer: TimerState;
  attachedEntry: Entry | null;
  recentEntries: Entry[];
  library: OpCode[];
  roTemplates: RoTemplate[];
}) {
  const router = useRouter();
  const running = initialTimer.startTime !== null;
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const [logRoOpen, setLogRoOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const [linePickEntry, setLinePickEntry] = useState<Entry | null>(null);
  const [preselectedLineId, setPreselectedLineId] = useState<string | null>(null);

  const libraryById = useMemo(
    () => new Map(library.map((oc) => [oc.id, oc])),
    [library],
  );

  function getLineLabel(line: EntryOpCode): { code: string; description: string } {
    if (line.custom) {
      return {
        code: (line.customCode ?? "").trim() || "—",
        description: (line.customDescription ?? "").trim(),
      };
    }
    const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
    return { code: ref?.code ?? "—", description: ref?.description ?? "" };
  }

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

  function handlePickWithLinePicker(entry: Entry) {
    if (entry.opCodes.length > 1) {
      setLinePickEntry(entry);
    } else {
      setPreselectedLineId(entry.opCodes[0]?.id ?? null);
      run(() => setTimerRoAction(entry.id));
    }
  }

  function handleLineConfirm(lineId: string, entry: Entry) {
    setPreselectedLineId(lineId);
    setLinePickEntry(null);
    if (entry.id !== attachedEntry?.id) {
      run(() => setTimerRoAction(entry.id));
    }
  }

  async function handleLogRoSave(input: NewEntry) {
    const saved = await saveEntry(input);
    await setTimerRoAction(saved.id);
    setPreselectedLineId(
      saved.opCodes.length === 1 ? (saved.opCodes[0]?.id ?? null) : null,
    );
    setLogRoOpen(false);
  }

  const canSave = attachedEntry !== null && elapsedMs > 0;

  const preselectedLine =
    preselectedLineId && attachedEntry
      ? (attachedEntry.opCodes.find((l) => l.id === preselectedLineId) ?? null)
      : null;

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
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      {/* Attached RO */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          Attached RO
        </h2>
        {attachedEntry ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailEntry(attachedEntry)}
                  className="font-mono text-sm text-orange-400 hover:underline"
                >
                  #{attachedEntry.roNumber}
                </button>
                <span className="text-xs text-zinc-500">
                  {formatDateShort(attachedEntry.date)}
                </span>
              </div>
              <VehicleLine entry={attachedEntry} />
              {attachedEntry.opCodes.length > 1 && (
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span className="text-zinc-500">Line:</span>
                  {preselectedLine ? (
                    <>
                      <span className="font-mono text-orange-300">
                        {getLineLabel(preselectedLine).code}
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

      {/* Recent ROs */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">Recent ROs</h2>
          <button
            type="button"
            onClick={() => setLogRoOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Plus className="h-3.5 w-3.5" />
            Log RO
          </button>
        </div>
        <RecentRoList
          entries={recentEntries}
          attachedId={attachedEntry?.id ?? null}
          disabled={pending}
          onPick={handlePickWithLinePicker}
          onOpenDetail={setDetailEntry}
        />
      </section>

      {/* Save modal */}
      {saveOpen && attachedEntry && (
        <TimerSaveModal
          entry={attachedEntry}
          library={library}
          elapsedMs={elapsedMs}
          initialLineId={preselectedLineId}
          onClose={() => setSaveOpen(false)}
        />
      )}

      {/* RO detail modal */}
      {detailEntry && (
        <RoDetailModal
          entry={detailEntry}
          library={library}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* Line picker modal */}
      {linePickEntry && (
        <Modal
          open
          onClose={() => setLinePickEntry(null)}
          title={`RO #${linePickEntry.roNumber} — Pick a line`}
        >
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Which line do you want to track time for?
            </p>
            <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {linePickEntry.opCodes.map((line) => {
                const { code, description } = getLineLabel(line);
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => handleLineConfirm(line.id, linePickEntry)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-zinc-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-sm text-orange-400">
                          {code}
                        </span>
                        {line.custom && (
                          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
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
          </div>
        </Modal>
      )}

      {/* Log RO full-screen overlay */}
      {logRoOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur">
            <h2 className="text-base font-semibold">Log New RO</h2>
            <button
              type="button"
              onClick={() => setLogRoOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <LogRoForm
            initialOpCodes={library}
            roTemplates={roTemplates}
            onSave={handleLogRoSave}
            redirectTo="/timer"
          />
        </div>
      )}
    </main>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

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
  onOpenDetail,
}: {
  entries: Entry[];
  attachedId: string | null;
  disabled: boolean;
  onPick: (entry: Entry) => void;
  onOpenDetail: (entry: Entry) => void;
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
        const canAttach = !disabled && !isAttached;
        const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
          .filter(Boolean)
          .join(" ")
          .trim();
        return (
          <li key={e.id}>
            <div
              role={canAttach ? "button" : undefined}
              tabIndex={canAttach ? 0 : undefined}
              onClick={() => canAttach && onPick(e)}
              onKeyDown={(ev) =>
                ev.key === "Enter" && canAttach && onPick(e)
              }
              className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                disabled ? "opacity-50" : ""
              } ${canAttach ? "cursor-pointer hover:bg-zinc-800/60" : "cursor-default"}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenDetail(e);
                    }}
                    className="font-mono text-sm text-orange-400 hover:underline"
                  >
                    #{e.roNumber}
                  </button>
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
