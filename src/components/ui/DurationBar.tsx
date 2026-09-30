import type { CSSProperties } from "react";

/** Bar length in hours, clamped: NaN, Infinity and negatives become 0. */
export function clampHours(hours: number): number {
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/**
 * Duration bar (mock `.dur`, final.html:618): length is the exact flagged
 * time, one block per hour (--hour wide), gaps between blocks.
 *
 * Accessibility: decorative, so it is `aria-hidden` by default. The bar is
 * only ever a picture of a figure printed next to it (the hours number), and
 * announcing it too would read the value twice. If a caller has no figure
 * nearby, pass `label` and it becomes role="img" with that name instead.
 *
 * `gapColor` overrides the block-gap colour (sets --dur-gap; defaults to the
 * panel colour) for use on a non-panel surface. `scaleNote` renders the
 * `.scale-note` legend ("one block = 1 hr") under the bar.
 */
export function DurationBar({
  hours,
  gapColor,
  scaleNote,
  label,
  className,
}: {
  hours: number;
  gapColor?: string;
  scaleNote?: string;
  label?: string;
  className?: string;
}) {
  const h = clampHours(hours);
  const style = { "--h": h, ...(gapColor ? { "--dur-gap": gapColor } : {}) } as CSSProperties;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <>
      <span className={`dur${className ? ` ${className}` : ""}`} style={style} {...a11y} />
      {scaleNote && (
        <span className="scale-note">
          <i aria-hidden="true" />
          {scaleNote}
        </span>
      )}
    </>
  );
}
