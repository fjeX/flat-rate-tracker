// A tiny stack of horizontal bars that all share ONE scale, so bar length is an
// honest picture of hours: the longest series fills the track and the others are
// drawn as a fraction of it. Used by Big jobs to set "you" against "the book".
//
// Colour is NEVER state here. A bar is either the accent (the tech's own number)
// or ink (the reference). Whether the gap is good or bad is the ratio cell's
// job; painting these green/red would say it twice and let a lopsided bar read
// as a verdict.
//
// `trueTime` is reserved for the pooled community figure that is coming. It is
// part of the series type now so that landing it later is one more entry in the
// array a caller passes, not a change to this component — and nothing renders
// for it until a caller actually passes one.
export type CompareSeries = {
  key: "you" | "book" | "trueTime";
  label: string;
  hours: number;
  tone: "accent" | "ink";
};

export function CompareBars({
  series,
  dim = false,
  fmt,
}: {
  series: CompareSeries[];
  /** Provisional rows: same geometry, quieter fill. */
  dim?: boolean;
  /** Hours formatter (fmtHours at the call site) — passed in so this file has
   *  no opinion about rounding. */
  fmt: (hours: number) => string;
}) {
  // One scale per call: the max of the series passed. Floor at a sliver so a
  // legitimately tiny value is still visible as a bar rather than as nothing.
  const scale = Math.max(...series.map((s) => s.hours), 0);
  return (
    // The bars are a picture of numbers the caller states in words; hiding them
    // from assistive tech avoids reading the same figures twice.
    <div className={`ins-cmp${dim ? " is-dim" : ""}`} aria-hidden="true">
      {series.map((s) => (
        <div className="ins-cmp-row" key={s.key}>
          <span className="ins-cmp-k">{s.label}</span>
          <span className="ins-cmp-track">
            <i
              className={`is-${s.tone}`}
              style={{ width: `${scale > 0 ? Math.max(2, (s.hours / scale) * 100) : 0}%` }}
            />
          </span>
          <span className="ins-cmp-v num">{fmt(s.hours)}h</span>
        </div>
      ))}
    </div>
  );
}
