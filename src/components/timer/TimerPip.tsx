"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import type { Entry } from "@/lib/types";
import { setTimerStatusAction } from "@/app/actions/timer";
import {
  elapsedFor,
  isAccruing,
  STATUS_LABEL_SHORT,
  STATUS_TONE,
  type TimerSlot,
} from "@/lib/timer";
import { formatElapsed } from "@/lib/timer";
import { Badge } from "@/components/ui/Badge";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { tap } from "@/lib/haptics";
import { useTickingNow } from "@/lib/use-ticking-now";

// The floating timer widget, mounted once in the app layout.
//
// With up to 3 concurrent timers this is ONE panel listing N rows, not N
// draggable pills — three independently-positioned widgets would fight each
// other for the same corner of a phone screen. Position and size are still
// per-panel, so the existing localStorage keys keep their meaning.

type PipSize = { w: number; h: number };

const DEFAULT_W = 340;
const MIN_W = 280;
const MAX_W = 560;
const MIN_H = 180;
const MAX_H = 460;

const POS_KEY = "frt:pip_pos";
const SIZE_KEY = "frt:pip_size";

export function TimerPip({
  slots,
  entries,
  caps,
}: {
  slots: TimerSlot[];
  entries: Entry[];
  caps: Record<string, number | null>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, startPending] = useTransition();

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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

  const anyAccruing = slots.some(isAccruing);
  const now = useTickingNow(anyAccruing);

  // Keep pos clamped if the window is resized and the panel would go off-screen
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

  // Nothing to float when there are no timers, and the timer page already IS
  // this. (Previously gated on a single READY status — with N slots the test is
  // "are there any at all".)
  if (pathname === "/timer" || slots.length === 0) return null;

  const entryById = new Map(entries.map((e) => [e.id, e]));

  // The headline row: whatever is working, else the first slot with time.
  const lead =
    slots.find((s) => s.status === "working") ??
    slots.find((s) => isAccruing(s)) ??
    slots[0];
  const leadElapsed = elapsedFor(lead, now, caps[lead.id] ?? null);
  const leadEntry = lead.entryId ? entryById.get(lead.entryId) : null;

  function run(action: () => Promise<void>) {
    startPending(async () => {
      try {
        await action();
      } catch {
        // Non-critical in pip context — the timer page surfaces real errors.
      }
      router.refresh();
    });
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
    if (!wasDrag && !expanded) setExpanded(true);
  }

  // ── Resize handlers ──────────────────────────────────────────────────────

  function onResizeDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current!.getBoundingClientRect();
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: rect.width, h: rect.height };
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

  const containerStyle: React.CSSProperties = {
    ...(pos
      ? { position: "fixed" as const, left: pos.x, top: pos.y, zIndex: 9999 }
      : {
          position: "fixed" as const,
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
        }),
    ...(expanded ? { width: size?.w ?? DEFAULT_W, height: size?.h ?? undefined } : {}),
  };

  const borderCls = anyAccruing ? "border-[var(--good)]" : "border-[var(--warn)]";
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`select-none touch-none cursor-grab active:cursor-grabbing rounded-[var(--radius)] border-2 ${borderCls} bg-[var(--bg-2)] shadow-[var(--shadow-pop)]`}
    >
      {expanded ? (
        <div className="relative flex h-full w-full flex-col rounded-[var(--radius)] p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <span className="pip-count">
              {slots.length} timer{slots.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onPointerDown={stopDrag}
              onClick={() => setExpanded(false)}
              className="relative flex items-center gap-0.5 py-2.5 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)] after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
              aria-label="Minimize timers"
            >
              <ChevronDown className="h-4 w-4" />
              minimize
            </button>
          </div>

          <div className="pip-rows flex-1 overflow-y-auto">
            {slots.map((s) => {
              const e = s.entryId ? entryById.get(s.entryId) : null;
              const el = elapsedFor(s, now, caps[s.id] ?? null);
              const accruing = isAccruing(s);
              return (
                <div
                  key={s.id}
                  className={`pip-row${s.status === "working" ? " active" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="ro block">
                      {e ? `#${e.roNumber}` : "—"}
                    </span>
                    <span className="why">{STATUS_LABEL_SHORT[s.status]}</span>
                  </span>
                  <RollingNumber
                    value={formatElapsed(el.work)}
                    className="time"
                  />
                  <button
                    type="button"
                    onPointerDown={stopDrag}
                    onClick={() => {
                      tap();
                      run(() =>
                        setTimerStatusAction(s.id, accruing ? "paused" : "working"),
                      );
                    }}
                    disabled={pending}
                    aria-label={
                      accruing
                        ? `Pause timer ${s.slot}`
                        : `Start working timer ${s.slot}`
                    }
                    className="relative shrink-0 text-[var(--fg-2)] hover:text-[var(--fg-0)] after:absolute after:-inset-3 after:content-['']"
                  >
                    {accruing ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Saving needs the line picker, which belongs on the real page. */}
          <Link
            href="/timer"
            onPointerDown={stopDrag}
            className="btn btn-sm btn-block mt-3"
          >
            Open timers
          </Link>

          <button
            type="button"
            aria-label="Resize timers panel"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            className="absolute -bottom-0.5 -right-0.5 flex h-11 w-11 cursor-nwse-resize touch-none items-end justify-end rounded-tl-[var(--radius-sm)] p-2 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M9 1v8H1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {lead.status === "working" && (
                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--good)] opacity-75" />
              )}
              <span
                className={`relative flex h-2.5 w-2.5 rounded-full ${
                  lead.status === "working"
                    ? "bg-[var(--good)]"
                    : anyAccruing
                      ? "bg-[var(--warn)]"
                      : "bg-[var(--fg-3)]"
                }`}
              />
            </span>
            <RollingNumber
              value={formatElapsed(leadElapsed.work)}
              className="text-base font-semibold text-[var(--fg-0)]"
            />
            {slots.length > 1 && (
              <Badge tone={STATUS_TONE[lead.status]}>+{slots.length - 1}</Badge>
            )}
            <button
              type="button"
              onPointerDown={stopDrag}
              onClick={() => setExpanded(true)}
              aria-label="Expand timers"
              className="relative text-[var(--fg-2)] hover:text-[var(--fg-1)] after:absolute after:-inset-3.5 after:content-['']"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          {leadEntry && (
            <span className="mt-0.5 text-xs text-[var(--fg-3)]">
              #{leadEntry.roNumber}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
