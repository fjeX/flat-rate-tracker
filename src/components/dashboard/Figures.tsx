import type { ReactNode } from "react";
import { withPt } from "@/components/ui/Figure";

/**
 * Sets every number in a sentence in the figure font (mock: `<span class="num">`
 * around each figure inside running text). The text itself is unchanged, so a
 * screen reader and copy/paste still get the same words.
 *
 * A figure is digits with optional , or . groups, and an optional trailing
 * h or % ("5.2h", "44", "12%"). Everything else stays on the UI font.
 */
export function FiguresInText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\d(?:[\d,]*\d)?(?:\.\d+)?[h%]?)/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num">
            {withPt(part)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
