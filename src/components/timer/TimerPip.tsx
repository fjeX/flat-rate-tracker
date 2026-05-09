"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, Save } from "lucide-react";
import type { Entry, OpCode } from "@/lib/types";
import {
  pauseTimerAction,
  resetTimerAction,
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

function getLineLabel(entry: Entry, library: OpCode[], lineId: string | null): string {
  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const line = (lineId ? entry.opCodes.find((l) => l.id === lineId) : null) ?? entry.opCodes[0];
  if (!line) return "";
  if (line.custom) {
    const parts = [line.customCode?.trim(), line.customDescription?.trim()].filter(Boolean);
    return parts.join(" · ");
  }
  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  return [ref?.code, ref?.description].filter(Boolean).join(" · ");
}

export function TimerPip({
  initialTimer,
  attachedEntry,
  library,
}: {
  initialTimer: TimerState;
  attachedEntry: Entry | null;
  library: OpCode[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startPending] = useTransition();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSelectedLineId(localStorage.getItem("frt:timer_line_id"));
    } catch { /* ignore */ }
  }, []);
  // null = default bottom-center CSS positioning; set after first drag
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const didDrag = useRef(false);

  const running = initialTimer.startTime !== null;
  const elapsedMs =
    initialTimer.accumulated +
    (running ? Math.max(0, now - initialTimer.startTime!) : 0);
  const status = running ? "RUNNING" : elapsedMs > 0 ? "PAUSED" : "READY";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Keep pos clamped if the window is resized and the pill would go off-screen
  useEffect(() => {
    function clamp() {
      if (!pos || !containerRef.current) return;
      const el = containerRef.current;
      setPos((p) => {
        if (!p) return p;
        return {
          x: Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, p.x)),
          y: Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, p.y)),
        };
      });
    }
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [pos]);

  // Don't render on the timer page or when timer hasn't been started yet
  if (pathname === "/timer" || status === "READY") return null;

  function run(action: () => Promise<void>) {
    startPending(async () => {
      try {
        await action();
      } catch {
        // ignore — action errors are non-critical in pip context
      }
      router.refresh();
    });
  }

  function handleReset() {
    if (
      elapsedMs > 0 &&
      !window.confirm(`Reset timer? ${formatElapsed(elapsedMs)} will be discarded.`)
    ) return;
    run(() => resetTimerAction());
  }

  // ── Drag handlers ────────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current!.getBoundingClientRect();
    dragStart.current = { mx: e.clientX, my: e.clientY, px: rect.left, py: rect.top };
    didDrag.current = false;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) didDrag.current = true;
    const el = containerRef.current!;
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, dragStart.current.px + dx)),
      y: Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, dragStart.current.py + dy)),
    });
  }

  function onPointerUp() {
    const wasDrag = didDrag.current;
    dragStart.current = null;
    didDrag.current = false;
    // Tap on collapsed pill → expand
    if (!wasDrag && !expanded) setExpanded(true);
  }

  // ── Positioning ──────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }
    : { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999 };

  const isRunning = status === "RUNNING";
  const borderCls = isRunning ? "border-green-600" : "border-amber-600";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div
        ref={containerRef}
        style={containerStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`select-none touch-none cursor-grab active:cursor-grabbing rounded-3xl border-2 ${borderCls} bg-zinc-900 shadow-2xl`}
      >
        {expanded ? (
          <ExpandedCard
            status={status}
            isRunning={isRunning}
            elapsedMs={elapsedMs}
            attachedEntry={attachedEntry}
            library={library}
            selectedLineId={selectedLineId}
            pending={pending}
            onMinimize={() => setExpanded(false)}
            onPause={() => run(() => pauseTimerAction())}
            onResume={() => run(() => startTimerAction())}
            onReset={handleReset}
            onSave={() => setSaveOpen(true)}
          />
        ) : (
          <CollapsedPill
            isRunning={isRunning}
            elapsedMs={elapsedMs}
            roNumber={attachedEntry?.roNumber ?? null}
            onExpand={() => setExpanded(true)}
          />
        )}
      </div>

      {saveOpen && attachedEntry && (
        <TimerSaveModal
          entry={attachedEntry}
          library={library}
          elapsedMs={elapsedMs}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CollapsedPill({
  isRunning,
  elapsedMs,
  roNumber,
  onExpand,
}: {
  isRunning: boolean;
  elapsedMs: number;
  roNumber: string | null;
  onExpand: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-2.5">
      <div className="flex items-center gap-2">
        {/* Status dot */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {isRunning && (
            <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-75" />
          )}
          <span
            className={`relative flex h-2.5 w-2.5 rounded-full ${
              isRunning ? "bg-green-400" : "bg-amber-400"
            }`}
          />
        </span>
        {/* Elapsed time */}
        <span className="font-mono text-base font-semibold tabular-nums text-zinc-100">
          {formatElapsed(elapsedMs)}
        </span>
        <span className="text-zinc-600">·</span>
        {/* Expand button — stops propagation so it doesn't also trigger the drag/tap handler */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onExpand}
          aria-label="Expand timer"
          className="text-zinc-400 hover:text-zinc-200"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>
      {roNumber && (
        <span className="mt-0.5 text-[10px] text-zinc-500">#{roNumber}</span>
      )}
    </div>
  );
}

function ExpandedCard({
  status,
  isRunning,
  elapsedMs,
  attachedEntry,
  library,
  selectedLineId,
  pending,
  onMinimize,
  onPause,
  onResume,
  onReset,
  onSave,
}: {
  status: string;
  isRunning: boolean;
  elapsedMs: number;
  attachedEntry: Entry | null;
  library: OpCode[];
  selectedLineId: string | null;
  pending: boolean;
  onMinimize: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const lineLabel = attachedEntry ? getLineLabel(attachedEntry, library, selectedLineId) : "";

  return (
    <div className="w-72 rounded-3xl p-4">
      {/* Header: status badge + minimize */}
      <div
        className="flex items-start justify-between mb-3"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-wide ${
            isRunning
              ? "border-green-700/60 bg-green-950/60 text-green-300"
              : "border-amber-700/60 bg-amber-950/60 text-amber-300"
          }`}
        >
          {isRunning && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative flex h-2 w-2 rounded-full bg-green-400" />
            </span>
          )}
          {status}
        </span>
        <button
          type="button"
          onClick={onMinimize}
          className="flex items-center gap-0.5 text-xs text-zinc-500 hover:text-zinc-200"
          aria-label="Minimize timer"
        >
          <ChevronDown className="h-4 w-4" />
          minimize
        </button>
      </div>

      {/* Time display */}
      <div className="text-center">
        <div className="font-mono text-4xl font-bold tabular-nums text-zinc-100">
          {formatElapsed(elapsedMs)}
        </div>
        {attachedEntry && (
          <div className="mt-1 truncate text-xs text-zinc-400">
            <span className="text-orange-400">#{attachedEntry.roNumber}</span>
            {lineLabel && <span> · {lineLabel}</span>}
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className="mt-4 flex gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isRunning ? (
          <button
            type="button"
            onClick={onPause}
            disabled={pending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Pause className="h-4 w-4" />
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={onResume}
            disabled={pending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          disabled={pending}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !attachedEntry || elapsedMs === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-2 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Save
        </button>
      </div>
    </div>
  );
}
