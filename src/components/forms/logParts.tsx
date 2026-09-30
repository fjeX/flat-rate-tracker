// Small shared pieces of the Log RO form and Quick Add, built from final.html:
// the solid pictograms the form needs (the shell's Icon set has no camera,
// search, plus, check, chevron or info), the op-code
// chips, and the running-total row. Styles are in styles/page-log.css.
import type { ReactNode } from "react";
import type { OpCode } from "@/lib/types";
import { Head, HeadRow } from "@/components/ui/Card";
import { withPt } from "@/components/ui/Figure";
import { fmtHours } from "@/lib/stats";

// Pictograms lifted from final.html's symbol sheet: solid, one weight, 24 grid.
const PATHS = {
  camera: <path d="M8.5 4h7l1.5 2.5h4a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1h4zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  search: (
    <>
      <path d="M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm0 2.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" />
      <path d="M15 16.8l1.8-1.8 5.2 5.2-1.8 1.8z" />
    </>
  ),
  plus: <path d="M10.75 4h2.5v6.75H20v2.5h-6.75V20h-2.5v-6.75H4v-2.5h6.75z" />,
  x: <path d="M6.3 4.5L12 10.2l5.7-5.7 1.8 1.8L13.8 12l5.7 5.7-1.8 1.8L12 13.8l-5.7 5.7-1.8-1.8L10.2 12 4.5 6.3z" />,
  chev: <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />,
  info: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.25 4.5h2.5V9h-2.5zm0 4h2.5v7h-2.5z" />,
  check: <path d="M9.5 16.2l-4.7-4.7L3 13.3l6.5 6.5L21.5 7.8 19.7 6z" />,
} satisfies Record<string, ReactNode>;

export type LogIconName = keyof typeof PATHS;

/** Decorative: every caller pairs it with a visible label or an aria-label. */
export function LogIcon({ name, small = false, className }: { name: LogIconName; small?: boolean; className?: string }) {
  return (
    <svg
      className={`ic${small ? " ic-sm" : ""}${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Op-code quick chips: code and book time, outlined, 48px. TOGGLES, per the
 * mock's RO-entry JS: a code that is on a line renders pressed (accent fill,
 * tick, aria-pressed="true") and stays visible; tapping it again removes that
 * line. A chip with sub op codes shows an arrow instead of hours, and tapping
 * it while unpressed opens the sub picker.
 *
 * A library code can be on MORE THAN ONE line (the search adds again, and a
 * code with sub op codes can be on a line per sub code). The mock's rule, kept:
 * pressed = at least one line carries this code; tapping a pressed chip removes
 * the LAST such line (one tap, one line), so the chip stays pressed until the
 * final one is gone. Lines are stored and computed exactly as before; this only
 * reads `lines` and calls the existing add / remove-line functions.
 */
export function OpCodeChips({
  chips,
  lines,
  onAdd,
  onRemoveLine,
}: {
  chips: OpCode[];
  /** Only the library id and row key are read. */
  lines: { key: string; opCodeId: string | null }[];
  onAdd: (oc: OpCode) => void;
  onRemoveLine: (key: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="log-chips" role="group" aria-label="Your op codes">
      {chips.map((oc) => {
        let lastKey: string | null = null;
        for (const l of lines) if (l.opCodeId === oc.id) lastKey = l.key;
        const pressed = lastKey !== null;
        return (
          <button
            key={oc.id}
            type="button"
            className="log-chip"
            aria-pressed={pressed}
            onClick={() => (lastKey !== null ? onRemoveLine(lastKey) : onAdd(oc))}
          >
            <LogIcon name="check" small className="tick" />
            <b>{oc.code}</b>
            <span className="num">{oc.subOpCodes.length > 0 ? "→" : `${fmtHours(oc.flagHours)}h`}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The running total: the headline panel as a single row. */
export function FlaggedTotal({ hours }: { hours: number }) {
  return (
    <Head className="log-total">
      <HeadRow>
        <span className="log-total-k">Flagged total</span>
        <span className="num" data-total>
          {withPt(fmtHours(hours))}
          <span className="unit">h</span>
        </span>
      </HeadRow>
    </Head>
  );
}
