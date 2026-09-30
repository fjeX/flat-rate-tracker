import type { ReactNode } from "react";
import { withPt } from "@/components/ui/Figure";

/**
 * One repair order as a tag (mock `.tag`): a punched hole on the left, the RO
 * number as the link, the hours top right, then the vehicle, the op codes and
 * the duration bar. The Recent ROs list and the Open tickets list are both
 * made of these, so they read as one kind of thing.
 *
 * The RO number is a button that opens the RO's detail dialog (the same
 * dialog every other list opens), styled as the mock's `.ro-link`.
 */
export function RoTag({
  roNumber,
  roLabel,
  onOpen,
  headExtra,
  when,
  hours,
  hoursTitle,
  body,
  action,
}: {
  roNumber: string;
  /** Accessible name for the RO button. Defaults to "RO <number>". */
  roLabel?: string;
  onOpen: () => void;
  /** Sits beside the RO number: a status tag, the open-ticket chip. */
  headExtra?: ReactNode;
  /** "Mar 11 · 2:02 PM" */
  when?: string;
  /** Already formatted by fmtHours. */
  hours: string;
  hoursTitle?: string;
  /** Vehicle, op codes, duration bar. */
  body: ReactNode;
  /** The Upsell shortcut. Its presence narrows the body to make room. */
  action?: ReactNode;
}) {
  return (
    <li className="tag">
      <span className="tag-hole" aria-hidden="true" />
      <div className="tag-head">
        <button
          type="button"
          className="ro-link"
          onClick={onOpen}
          aria-label={roLabel ?? `RO ${roNumber}`}
        >
          #{roNumber}
        </button>
        {headExtra}
        {when && <span className="tag-when">{when}</span>}
      </div>
      <div className="tag-hrs-cell" title={hoursTitle}>
        <span className="tag-hrs">
          {withPt(hours)}
          <span className="unit">h</span>
        </span>
      </div>
      <div className={`tag-body${action ? " has-act" : ""}`}>{body}</div>
      {action && <div className="tag-act">{action}</div>}
    </li>
  );
}
