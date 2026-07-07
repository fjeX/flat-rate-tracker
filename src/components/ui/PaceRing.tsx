"use client";

import { useEffect, useState } from "react";

type Tier = "good" | "warn" | "bad" | null;

/**
 * Circular progress ring — the instrument-cluster "gauge" read for a single
 * point-in-time value (e.g. % of pace goal reached). Stroke color follows
 * the existing efficiency tiers; sweeps from 0 to value once on mount, then
 * settles (no re-sweep on later prop updates — those just snap).
 *
 * Reduced motion: renders at final value immediately, no sweep.
 */
export function PaceRing({
  value,
  size = 72,
  strokeWidth = 8,
  tier = null,
  label,
  sublabel,
}: {
  /** 0..1 fraction of goal reached (values outside this range are clamped). */
  value: number;
  size?: number;
  strokeWidth?: number;
  tier?: Tier;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - clamped);

  const [reduceMotion, setReduceMotion] = useState(false);
  const [phase, setPhase] = useState<"pre" | "sweeping" | "settled">("pre");

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const raf = requestAnimationFrame(() => setReduceMotion(mq.matches));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      setPhase(reduceMotion ? "settled" : "sweeping"),
    );
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  const offset = phase === "pre" ? circumference : targetOffset;
  const strokeColor =
    tier === "good"
      ? "var(--good)"
      : tier === "warn"
      ? "var(--warn)"
      : tier === "bad"
      ? "var(--bad)"
      : "var(--brand)";

  return (
    <div
      className="pace-ring"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped * 100)}% of pace goal`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-3)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            transitionProperty: "stroke-dashoffset",
            transitionDuration: phase === "sweeping" ? "700ms" : "0ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
          onTransitionEnd={() => setPhase("settled")}
        />
      </svg>
      <div className="pace-ring-center">
        <div className="pace-ring-value mono tabular">{label}</div>
        {sublabel && <div className="pace-ring-sub">{sublabel}</div>}
      </div>
    </div>
  );
}
