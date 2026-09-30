import type { HTMLAttributes, ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

export type StatusTone = "neutral" | "good" | "bad";

/** What each conventional tag word means. Colour is state, never decoration. */
const TAG_TONE: Record<string, StatusTone> = { Fix: "bad", Cost: "bad", Saved: "good" };

/**
 * The tagged status field (mock `.stat`; the class is `.sfield` because the
 * app already has a `.stat` tile): a full-width field with a word in a box.
 *
 *   Note   something to know, or a choice to make (neutral)
 *   Fix    something is wrong and the tech can correct it (bad)
 *   Cost   money lost (bad)
 *   Saved  a confirmation (good)
 *
 * The tone follows the tag word unless `tone` says otherwise, so a custom tag
 * ("Done", "Read") passes its tone. The tag word says the state too, so it
 * never depends on colour alone.
 *
 * `role` defaults to "note". Use "alert" for an error that appears after an
 * action. For a message that comes and goes inside a live region, keep the
 * region mounted and put the field inside it: a live region that appears
 * together with its text is not announced.
 */
export function StatusField({
  tag,
  tone,
  inset,
  role = "note",
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  tag: "Note" | "Cost" | "Fix" | "Saved" | (string & {});
  tone?: StatusTone;
  /** Sits inside a panel, well or dialog: keeps its own side padding instead of bleeding to the gutter. */
  inset?: boolean;
  children: ReactNode;
}) {
  const t = tone ?? TAG_TONE[tag] ?? "neutral";
  const cls = ["sfield", t !== "neutral" && `is-${t}`, inset && "is-inset", className].filter(Boolean).join(" ");
  return (
    <div className={cls} role={role} {...rest}>
      <Badge tone={t} className="sfield-tag">
        {tag}
      </Badge>
      <div className="sfield-body">{children}</div>
    </div>
  );
}
