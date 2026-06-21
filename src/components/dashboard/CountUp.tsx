"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 up to `value` on mount (easeOutCubic).
 *
 * SSR renders the final value (so no-JS and the first paint are correct, and
 * there's no hydration mismatch); the mount effect then runs the count-up.
 * Respects prefers-reduced-motion and skips zero values.
 */
export function CountUp({
  value,
  decimals = 1,
  durationMs = 700,
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Snap straight to the value when motion is off or there's nothing to count.
    // Routed through rAF so the state update is async (never synchronous in the effect).
    if (reduce || value === 0) {
      rafRef.current = requestAnimationFrame(() => setDisplay(value));
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    const start = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return <span className={className}>{display.toFixed(decimals)}</span>;
}
