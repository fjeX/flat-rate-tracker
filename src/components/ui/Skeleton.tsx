/**
 * Skeleton loaders — shape-accurate placeholders for the server-fetched
 * views (dashboard, history, pay period). Boring on purpose: no glow, no
 * brand color, just an opacity pulse on the --plate fill. Neutralized to
 * a static block under prefers-reduced-motion (see globals.css guard).
 */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`skel${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Mirrors `.ro-row` / `.history-ro-row` layout — number, meta, vehicle, hours. */
export function RoListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card flush">
      <div className="ro-list">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="ro-row" style={{ cursor: "default" }}>
            <div className="grow">
              <Skeleton style={{ width: 90, height: 14, marginBottom: 6 }} />
              <Skeleton style={{ width: 140, height: 12 }} />
            </div>
            <Skeleton style={{ width: 48, height: 16 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mirrors the `.r-*` bar chart card (readout row + chart block + footer). */
export function ChartSkeleton() {
  return (
    <section>
      <Skeleton style={{ width: 110, height: 11, marginBottom: 8 }} />
      <div className="card padded">
        <Skeleton style={{ width: "45%", height: 28, marginBottom: 14 }} />
        <Skeleton style={{ width: "100%", height: 130, borderRadius: "var(--r-sign)" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <Skeleton style={{ width: 70, height: 13 }} />
          <Skeleton style={{ width: 90, height: 13 }} />
        </div>
      </div>
    </section>
  );
}
