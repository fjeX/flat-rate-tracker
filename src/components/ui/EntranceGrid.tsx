"use client";

import { useState } from "react";

/**
 * Wraps a `.stat-grid` (or any tile grid using the `fade-up` entrance
 * animation) so the stagger-in plays once per mount and never re-fires on
 * later re-renders — e.g. a dashboard quick-add refetch via router.refresh().
 *
 * As a client component, this instance's `animated` state survives Server
 * Component re-renders of its parent (router.refresh() re-renders the
 * server tree but reconciles against this same component instance instead
 * of remounting it). Once the last tile's fade-up finishes, `data-animated`
 * flips on and globals.css stops applying the animation — see the
 * `.stat-grid:not([data-animated="true"]) .stat` rule.
 */
export function EntranceGrid({
  className,
  animationName = "fade-up",
  children,
}: {
  className?: string;
  /** CSS `@keyframes` name to watch for — flips the gate once it completes. */
  animationName?: string;
  children: React.ReactNode;
}) {
  const [animated, setAnimated] = useState(false);

  return (
    <div
      className={className}
      data-animated={animated ? "true" : undefined}
      onAnimationEnd={(e) => {
        if (e.animationName === animationName) setAnimated(true);
      }}
    >
      {children}
    </div>
  );
}
