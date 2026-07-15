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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { tap } from "@/lib/haptics";
import { useTickingNow } from "@/lib/use-ticking-now";

type TimerState = {
  roId: string | null;
  startTime: number | null;
  accumulated: number;
};

type PipSize = { w: number; h: number };

// Expanded-card size bounds (px). Default width leaves room for the
// three-button row; min width keeps Save inside the card.
const DEFAULT_W = 360;
const MIN_W = 300;
const MAX_W = 560;
const MIN_H = 210;
const MAX_H = 440;

const POS_KEY = "frt:pip_pos";
const SIZE_KEY = "frt:pip_size";

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
  const [pending, startPending] = useTransition();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSelectedLineId(localStorage.getItem("frt:timer_line_id"));
    } catch { /* ignore */ }
  }, [pathname]);

  // null = default bottom-center CSS positioning; set after first drag
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // null = intrinsic size; set after first resize (expanded card only)
  const [size, setSize] = useState<PipSize | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeStart = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);
  const didDrag = useRef(false);

  // Restore persisted position/size once on mount, clamped to the viewport
  useEffect(() => {
    try {
      const rawPos = localStorage.getItem(POS_KEY);
      if (rawPos) {
        const p = JSON.parse(rawPos) as { x: number; y: number };
        setPos({
          x: Math.max(8, Math.min(window.innerWidth - MIN_W - 8, p.x)),
          y: Math.max(8, Math.min(window.innerHeight - 48, p.y)),
        });
      }
      const rawSize = localStorage.getItem(SIZE_KEY);
      if (rawSize) {
        const s = JSON.parse(rawSize) as PipSize;
        setSize({
          w: Math.max(MIN_W, Math.min(MAX_W, s.w)),
          h: Math.max(MIN_H, Math.min(MAX_H, s.h)),
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch { /* ignore */ }
  }, [pos]);

  useEffect(() => {
    try {
      if (size) localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch { /* ignore */ }
  }, [size]);

  const running = initialTimer.startTime !== null;
  const now = useTickingNow(running);
  const elapsedMs =
    initialTimer.accumulated +
    (running ? Math.max(0, now - initialTimer.startTime!) : 0);
  const status = running ? "RUNNING" : elapsedMs > 0 ? "PAUSED" : "READY";

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

  // ── Drag handlers (whole surface, collapsed or expanded) ─────────────────
  // Buttons and the resize grip stop propagation so they never start a drag.

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

  // ── Resize handlers (corner grip, expanded card only) ────────────────────

  function onResizeDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current!.getBoundingClientRect();
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: rect.width, h: rect.height };
    // Resizing pins the card where it sits — convert default centering to
    // explicit coordinates so growth extends right/down from the corner grip.
    if (!pos) setPos({ x: rect.left, y: rect.top });
  }

  function onResizeMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!resizeStart.current) return;
    e.stopPropagation();
    setSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + (e.clientX - resizeStart.current.mx))),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + (e.clientY - resizeStart.current.my))),
    });
  }

  function onResizeUp(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    resizeStart.current = null;
  }

  // ── Positioning ──────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    ...(pos
      ? { position: "fixed" as const, left: pos.x, top: pos.y, zIndex: 9999 }
      : { position: "fixed" as const, bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999 }),
    ...(expanded ? { width: size?.w ?? DEFAULT_W, height: size?.h ?? undefined } : {}),
  };

  const isRunning = status === "RUNNING";
  const borderCls = isRunning ? "border-[var(--good)]" : "border-[var(--warn)]";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div
        ref={containerRef}
        style={containerStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`select-none touch-none cursor-grab active:cursor-grabbing rounded-[var(--radius)] border-2 ${borderCls} bg-[var(--bg-2)] shadow-[var(--shadow-pop)]`}
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
            width={size?.w ?? DEFAULT_W}
            onMinimize={() => setExpanded(false)}
            onPause={() => { tap(); run(() => pauseTimerAction()); }}
            onResume={() => { tap(); run(() => startTimerAction()); }}
            onReset={handleReset}
            onSave={() => setSaveOpen(true)}
            onResizeDown={onResizeDown}
            onResizeMove={onResizeMove}
            onResizeUp={onResizeUp}
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
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--good)] opacity-75" />
          )}
          <span
            className={`relative flex h-2.5 w-2.5 rounded-full ${
              isRunning ? "bg-[var(--good)]" : "bg-[var(--warn)]"
            }`}
          />
        </span>
        {/* Elapsed time */}
        <RollingNumber
          value={formatElapsed(elapsedMs)}
          className="text-base font-semibold text-[var(--fg-0)]"
        />
        <span className="text-[var(--fg-3)]">·</span>
        {/* Expand button — stops propagation so it doesn't also trigger the drag/tap handler */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onExpand}
          aria-label="Expand timer"
          className="relative text-[var(--fg-2)] hover:text-[var(--fg-1)] after:absolute after:-inset-3.5 after:content-['']"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>
      {roNumber && (
        <span className="mt-0.5 text-xs text-[var(--fg-3)]">#{roNumber}</span>
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
  width,
  onMinimize,
  onPause,
  onResume,
  onReset,
  onSave,
  onResizeDown,
  onResizeMove,
  onResizeUp,
}: {
  status: string;
  isRunning: boolean;
  elapsedMs: number;
  attachedEntry: Entry | null;
  library: OpCode[];
  selectedLineId: string | null;
  pending: boolean;
  width: number;
  onMinimize: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSave: () => void;
  onResizeDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const lineLabel = attachedEntry ? getLineLabel(attachedEntry, library, selectedLineId) : "";
  // Time readout tracks the card width (36px at default 360, clamped) — the
  // digits are ch/em-based so the whole odometer scales with font-size.
  const timeFontSize = Math.round(Math.max(28, Math.min(56, 36 * (width / DEFAULT_W))));
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div className="relative flex h-full w-full flex-col rounded-[var(--radius)] p-4">
      {/* Header: status badge + minimize (row itself stays draggable) */}
      <div className="mb-3 flex items-start justify-between">
        <Badge tone={isRunning ? "good" : "warn"}>
          {isRunning && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--good)] opacity-75" />
              <span className="relative flex h-2 w-2 rounded-full bg-[var(--good)]" />
            </span>
          )}
          {isRunning ? "Running" : "Paused"}
        </Badge>
        <button
          type="button"
          onPointerDown={stopDrag}
          onClick={onMinimize}
          className="relative flex items-center gap-0.5 py-2.5 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
          aria-label="Minimize timer"
        >
          <ChevronDown className="h-4 w-4" />
          minimize
        </button>
      </div>

      {/* Time display — flexes to fill when the card is stretched taller */}
      <div className="flex flex-1 flex-col justify-center text-center">
        <div style={{ fontSize: timeFontSize }}>
          <RollingNumber
            value={formatElapsed(elapsedMs)}
            className="font-bold text-[var(--fg-0)]"
          />
        </div>
        {attachedEntry && (
          <div className="mt-1 truncate text-xs text-[var(--fg-2)]">
            <span className="text-[var(--brand)]">#{attachedEntry.roNumber}</span>
            {lineLabel && <span> · {lineLabel}</span>}
          </div>
        )}
      </div>

      {/* Controls (buttons stop drag; the gaps between them stay draggable) */}
      <div className="mt-4 flex gap-2">
        {isRunning ? (
          <Button onPointerDown={stopDrag} onClick={onPause} disabled={pending} className="min-w-0 flex-1">
            <Pause className="h-4 w-4 shrink-0" />
            Pause
          </Button>
        ) : (
          <Button onPointerDown={stopDrag} onClick={onResume} disabled={pending} className="min-w-0 flex-1">
            <Play className="h-4 w-4 shrink-0" />
            Resume
          </Button>
        )}
        <Button onPointerDown={stopDrag} onClick={onReset} disabled={pending} className="min-w-0 flex-1">
          <RotateCcw className="h-4 w-4 shrink-0" />
          Reset
        </Button>
        <Button
          variant="primary"
          onPointerDown={stopDrag}
          onClick={onSave}
          disabled={pending || !attachedEntry || elapsedMs === 0}
          className="min-w-0 flex-1"
        >
          <Save className="h-4 w-4 shrink-0" />
          Save
        </Button>
      </div>

      {/* Resize grip — bottom-right corner, browser-window style */}
      <button
        type="button"
        aria-label="Resize timer"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        className="absolute -bottom-0.5 -right-0.5 flex h-11 w-11 cursor-nwse-resize touch-none items-end justify-end rounded-tl-[var(--radius-sm)] p-2 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
