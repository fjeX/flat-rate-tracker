"use client";

// Small shared parts for the Pay Period page, built from final.html's
// #screen-pay-period. They live here, not in components/ui, because the shared
// set is owned by another phase; each one composes ui parts where a
// ui part exists. Styles: src/app/styles/page-pay-period.css (.pp-*).
import type { ReactNode } from "react";
import { withPt } from "@/components/ui/Figure";

/**
 * An inline figure inside a sentence (mock `<b class="num">`): the figure font,
 * emphasised, decimal pulled in. Text content is unchanged ("44.4h" copies and
 * reads as "44.4h"). Money, hours and percentages only.
 */
export function N({ v, className }: { v: string; className?: string }) {
  return <b className={`num${className ? ` ${className}` : ""}`}>{withPt(v)}</b>;
}

// ---- Pictograms -------------------------------------------------------------
// Solid, one weight, 24 grid: the same drawing rules as components/layout/icons.
// (chev, check, plus are lifted from final.html's symbol sheet; pencil and
// trash are drawn to the same rules because the mock has no row-edit controls.)
const PATHS = {
  chev: <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />,
  check: <path d="M9.5 16.2l-4.7-4.7L3 13.3l6.5 6.5L21.5 7.8 19.7 6z" />,
  plus: <path d="M10.75 4h2.5v6.75H20v2.5h-6.75V20h-2.5v-6.75H4v-2.5h6.75z" />,
  pencil: <path d="M4 16.6V20h3.4L18.5 8.9l-3.4-3.4zM19.9 7.5a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.5 1.5 3.4 3.4z" />,
  trash: <path d="M9 3h6v2h5v2.5H4V5h5zM5.5 9.5h13l-1 11.5h-11zM9 12v6.5h1.75V12zm4.25 0v6.5H15V12z" />,
  link: <path d="M8 7h3v2.5H8a2.5 2.5 0 0 0 0 5h3V17H8a5 5 0 0 1 0-10zm5 0h3a5 5 0 0 1 0 10h-3v-2.5h3a2.5 2.5 0 0 0 0-5h-3zm-4 4h6v2H9z" />,
} satisfies Record<string, ReactNode>;

export type PpIconName = keyof typeof PATHS;

/** Decorative: every caller pairs it with visible text or an aria-label. */
export function PpIcon({
  name,
  small = true,
  className,
  style,
}: {
  name: PpIconName;
  small?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={`ic${small ? " ic-sm" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

// ---- Fold -------------------------------------------------------------------
// A section that opens and closes (mock `.fold`): a full-width title button
// with a sub-line and a state word, and the (i) as its SIBLING, never nested
// in the button. `info` is the InfoBubble, passed in by the card.
export function Fold({
  id,
  title,
  sub,
  state,
  stateTone,
  open,
  onToggle,
  info,
  children,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  /** Shown beside the chevron while the fold is shut (a one-glance summary). */
  state?: ReactNode;
  stateTone?: "good" | "bad";
  open: boolean;
  onToggle: () => void;
  info?: ReactNode;
  children?: ReactNode;
}) {
  const bodyId = `${id}-body`;
  return (
    <section className="pp-fold">
      <div className="pp-fold-head">
        <h3 className="pp-fold-h">
          <button
            type="button"
            className="pp-fold-btn"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={bodyId}
          >
            <span className="pp-fold-txt">
              <span className="pp-fold-title">{title}</span>
              {sub != null && <span className="pp-fold-sub">{sub}</span>}
            </span>
            {state != null && !open && (
              <span className={`pp-fold-state${stateTone ? ` is-${stateTone}` : ""}`}>{state}</span>
            )}
            <PpIcon name="chev" className="chev" />
          </button>
        </h3>
        {info}
      </div>
      {open && (
        <div className="pp-fold-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
