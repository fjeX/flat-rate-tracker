export type TrackTick = { key: string | number; label: string; left: number; cls?: string };

/**
 * A track and its scale (mock `.track` + `.ticks`): a flat 14px bar that fills
 * left to right, a row of tick labels under it. Ticks the fill has passed are
 * `done` (full ink). `fill` and every `left` are percentages of the width.
 *
 * The track is a picture of figures printed next to it, so it carries a
 * plain-language `label` for screen readers and the tick row is hidden from
 * them (they would read the same numbers twice).
 */
export function Track({
  fill,
  label,
  ticks,
  endMark,
}: {
  fill: number;
  label: string;
  ticks?: TrackTick[];
  /** A 3px marker at the far end of the track (the goal, the unlock). */
  endMark?: boolean;
}) {
  const f = Math.min(Math.max(fill, 0), 100);
  return (
    <>
      <div className="track" role="img" aria-label={label}>
        <i className="fill" style={{ width: `${f}%` }} />
        {endMark && <i className="mk end" style={{ left: "100%" }} />}
      </div>
      {ticks && ticks.length > 0 && (
        <div className="ticks" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.key} className={t.cls} style={{ left: `${t.left}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
