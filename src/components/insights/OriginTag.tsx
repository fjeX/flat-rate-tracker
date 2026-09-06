// The ONE origin tag. It was two — one here in the op-code table, one in
// JobTimeSections — with the same text and two different styling mechanisms
// (a Tailwind arbitrary value vs an inline `style`), which is the drift the
// duplicated caption two files over already cost us once. Three tables print
// this tag; there is one component.
import { opCodeOrigin, OP_CODE_ORIGIN_LABEL } from "@/lib/insights";

/**
 * "library" / "custom" — the quietest thing that can tell two identically
 * coded rows apart.
 *
 * `op_codes.code` has no unique constraint and a typed-in line's code is free
 * text, so a library ALIGN and a typed ALIGN print identically. The grouping
 * layer never merged them (`groupKey` keys them `lib:` / `custom:`, and
 * lib/time-inference keys its rows the same way); only the screen did, and the
 * one disambiguator on screen — `description` — is optional and commonly blank.
 *
 * Dim and small on purpose: nothing on these rows is clickable and no figure is
 * at risk, so this is legibility, not a warning. The wording lives in
 * lib/insights beside the predicate.
 */
export function OriginTag({ row }: { row: { key: string } }) {
  return (
    <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wide text-[var(--fg-3)]">
      {OP_CODE_ORIGIN_LABEL[opCodeOrigin(row)]}
    </span>
  );
}
