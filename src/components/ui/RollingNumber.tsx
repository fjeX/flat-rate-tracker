"use client";

import { useEffect, useState } from "react";

const DIGITS = "0123456789".split("");

/**
 * Renders an already-formatted string like "5.4" or "01:23:45" and, when the
 * value CHANGES while mounted, rolls each digit vertically like a mechanical
 * odometer. First render is always static — the roll only fires on subsequent
 * updates.
 *
 * It renders text; it does NOT decide what the text says. That used to be a
 * `number | string` prop with a `decimals` option running a bare
 * `value.toFixed(decimals)`, and it was the app's fourth private copy of a
 * hours-rounding rule. `toFixed` TRUNCATES an x.x5 value — float64 stores 5.35
 * a hair below 5.35 — while lib/format.ts's fmtHours rounds half-up, so a
 * stored 5.35 printed "5.3" in the dashboard's headline tile and "5.4" in the
 * RO row directly beneath it, on the same screen (`dashboard-flag-hours-
 * rounding`). The sr-only readout carried the wrong figure too.
 *
 * Rounding half-up in here would have closed half the gap and left the other
 * half: fmtHours also floors a sub-resolution nonzero to "<0.1" rather than a
 * flat "0.0", which is the entire reason lib/format.ts exists. Hours semantics
 * belong to the hours formatter, not to a UI primitive — so `value` is a
 * string, and a caller with a raw number has to name the formatter it wants.
 * A fifth caller now gets a type error instead of a silent truncation.
 *
 * Mono + tabular-nums per house rule; respects prefers-reduced-motion by
 * snapping instantly (also backstopped by the global reduced-motion CSS
 * guard in globals.css, which zeroes all transition durations).
 */
export function RollingNumber({
  value,
  className,
  children,
}: {
  /** Pre-formatted text, e.g. fmtHours(n) or "01:23:45". Digits roll; the rest doesn't. */
  value: string;
  className?: string;
  /** Trailing content rendered after the digits (e.g. a unit label) — never rolls. */
  children?: React.ReactNode;
}) {
  const chars = value.split("");

  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    // Route the initial read through rAF too, so the state update is never
    // synchronous inside the effect body (matches CountUp.tsx's approach).
    const raf = requestAnimationFrame(() => setReduceMotion(mq.matches));
    const handler = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener?.("change", handler);
    };
  }, []);

  useEffect(() => {
    // Mount paints statically; enabling transitions from the next frame on
    // means only real value CHANGES animate, never the initial paint.
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const animate = ready && !reduceMotion;

  // Digit positions from the right (rightmost = 0), computed without
  // mutating a loop-local variable across the render's .map callback.
  const digitIndices = chars
    .map((c, i) => (c >= "0" && c <= "9" ? i : -1))
    .filter((i) => i >= 0);

  return (
    <span className={`rn mono tabular${className ? ` ${className}` : ""}`}>
      {/* Digit strips render every 0-9 cell per position for the roll effect —
          hide the whole visual readout from AT and expose a plain-text
          equivalent instead, so a screen reader reads the value once, not
          every digit-strip cell. */}
      <span aria-hidden="true" style={{ display: "contents" }}>
        {chars.map((ch, i) => {
          if (ch < "0" || ch > "9") {
            return (
              <span key={i} className="rn-sep">
                {ch}
              </span>
            );
          }
          // Stagger right-to-left: rightmost digit (posFromRight=0) moves first.
          const posFromRight = digitIndices.length - 1 - digitIndices.indexOf(i);
          return (
            <RollDigit
              key={i}
              digit={ch}
              animate={animate}
              delayMs={Math.min(posFromRight, 6) * 30}
            />
          );
        })}
      </span>
      <span className="sr-only">{value}</span>
      {children}
    </span>
  );
}

function RollDigit({
  digit,
  animate,
  delayMs,
}: {
  digit: string;
  animate: boolean;
  delayMs: number;
}) {
  const n = Number(digit);
  return (
    <span className="rn-digit">
      <span
        className="rn-digit-strip"
        style={{
          transform: `translateY(${-n * 10}%)`,
          transitionDuration: animate ? "450ms" : "0ms",
          transitionDelay: animate ? `${delayMs}ms` : "0ms",
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="rn-digit-cell">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}
