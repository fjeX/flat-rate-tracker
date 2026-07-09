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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { LogRoForm } from "@/components/forms/LogRoForm";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { tap } from "@/lib/haptics";

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

  // Restore selected line from localStorage when the attached RO is known
  useEffect(() => {
    if (!attachedEntry) return;
    try {
      const stored = localStorage.getItem("frt:timer_line_id");
      if (stored && attachedEntry.opCodes.some((l) => l.id === stored)) {
        setPreselectedLineId(stored);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedEntry?.id]);

  function persistLineId(id: string | null) {
    setPreselectedLineId(id);
    try {
      if (id) localStorage.setItem("frt:timer_line_id", id);
      else localStorage.removeItem("frt:timer_line_id");
    } catch { /* ignore */ }
  }

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
    persistLineId(null);
    run(() => setTimerRoAction(null));
  }

  function handlePickWithLinePicker(entry: Entry) {
    if (entry.opCodes.length > 1) {
      setLinePickEntry(entry);
    } else {
      persistLineId(entry.opCodes[0]?.id ?? null);
      run(() => setTimerRoAction(entry.id));
    }
  }

  function handleLineConfirm(lineId: string, entry: Entry) {
    persistLineId(lineId);
    setLinePickEntry(null);
    if (entry.id !== attachedEntry?.id) {
      run(() => setTimerRoAction(entry.id));
    }
  }

  async function handleLogRoSave(input: NewEntry) {
    const saved = await saveEntry(input);
    await setTimerRoAction(saved.id);
    persistLineId(saved.opCodes.length === 1 ? (saved.opCodes[0]?.id ?? null) : null);
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
      <div className="card p-6 text-center">
        <StatusBadge status={status} />
        <RollingNumber
          value={formatElapsed(elapsedMs)}
          className="mt-3 text-5xl font-semibold text-[var(--fg-0)] sm:text-6xl"
        />
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {running ? (
            <Button
              variant="primary"
              onClick={() => { tap(); run(() => pauseTimerAction()); }}
              disabled={pending}
            >
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button
              variant="good"
              onClick={() => { tap(); run(() => startTimerAction()); }}
              disabled={pending}
            >
              <Play className="h-4 w-4" />
              {status === "PAUSED" ? "Resume" : "Start"}
            </Button>
          )}
          <Button onClick={handleReset} disabled={pending || status === "READY"}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-[var(--bad)]">{error}</p>}
      </div>

      {/* Attached RO */}
      <section className="card p-4">
        <h2 className="section-title">Attached RO</h2>
        {attachedEntry ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailEntry(attachedEntry)}
                  className="font-mono text-sm text-[var(--brand)] hover:underline"
                >
                  #{attachedEntry.roNumber}
                </button>
                <span className="text-xs text-[var(--fg-3)]">
                  {formatDateShort(attachedEntry.date)}
                </span>
              </div>
              <VehicleLine entry={attachedEntry} />
              {attachedEntry.opCodes.length > 1 && (
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span className="text-[var(--fg-3)]">Line:</span>
                  {preselectedLine ? (
                    <>
                      <span className="font-mono text-[var(--brand)]">
                        {getLineLabel(preselectedLine).code}
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
              <Button
                variant="primary"
                onClick={() => setSaveOpen(true)}
                disabled={!canSave || pending}
                title={
                  !canSave && elapsedMs === 0
                    ? "Start the timer first"
                    : undefined
                }
              >
                <Save className="h-4 w-4" />
                Save to Job
              </Button>
              <Button
                variant="ghost"
                onClick={handleClearRo}
                disabled={pending}
                aria-label="Clear attached RO"
                title="Clear attached RO"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--fg-2)]">
            No RO attached. Pick one from the list below to track time against
            it.
          </p>
        )}
      </section>

      {/* Recent ROs */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--fg-2)]">Recent ROs</h2>
          <Button size="sm" onClick={() => setLogRoOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Log RO
          </Button>
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
            <p className="text-sm text-[var(--fg-2)]">
              Which line do you want to track time for?
            </p>
            <ul className="card-inset divide-y divide-[var(--line-soft)] overflow-hidden">
              {linePickEntry.opCodes.map((line) => {
                const { code, description } = getLineLabel(line);
                return (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => handleLineConfirm(line.id, linePickEntry)}
                      className="flex w-full min-h-[44px] items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-3)]/40"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-sm text-[var(--brand)]">
                          {code}
                        </span>
                        {line.custom && (
                          <Badge className="ml-2">Other</Badge>
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
          </div>
        </Modal>
      )}

      {/* Log RO full-screen overlay */}
      {logRoOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-0)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-0)]/90 px-4 py-3 backdrop-blur">
            <h2 className="text-base font-semibold">Log New RO</h2>
            <Button variant="ghost" onClick={() => setLogRoOpen(false)} aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
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
  const tone = { READY: "neutral", RUNNING: "good", PAUSED: "warn" } as const;
  const label = { READY: "Ready", RUNNING: "Running", PAUSED: "Paused" } as const;
  return (
    <Badge tone={tone[status]}>
      {status === "RUNNING" && (
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--good)] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--good)]" />
        </span>
      )}
      {label[status]}
    </Badge>
  );
}

function VehicleLine({ entry }: { entry: Entry }) {
  const label = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!label) return null;
  return (
    <div className="mt-0.5 truncate text-xs text-[var(--fg-2)]">{label}</div>
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
      <div className="card p-6 text-center">
        <p className="text-sm text-[var(--fg-2)]">The timer clocks against an RO — log one first.</p>
      </div>
    );
  }
  return (
    <ul className="card divide-y divide-[var(--line-soft)]">
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
              } ${canAttach ? "cursor-pointer hover:bg-[var(--bg-3)]" : "cursor-default"}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenDetail(e);
                    }}
                    className="font-mono text-sm text-[var(--brand)] hover:underline"
                  >
                    #{e.roNumber}
                  </button>
                  <span className="text-xs text-[var(--fg-3)]">
                    {formatDateShort(e.date)}
                  </span>
                  {isAttached && <Badge tone="brand">Attached</Badge>}
                </div>
                {vehicle && (
                  <div className="mt-0.5 truncate text-xs text-[var(--fg-2)]">
                    {vehicle}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-sm font-medium text-[var(--fg-0)]">
                {fmtHours(e.flagHours)}h
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
