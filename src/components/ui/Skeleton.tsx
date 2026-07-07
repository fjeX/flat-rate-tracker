/**
 * Skeleton loaders — shape-accurate placeholders for the server-fetched
 * views (dashboard, history, pay period). Boring on purpose: no glow, no
 * brand color, just a subtle shimmer sweep across bg-3/bg-4. Neutralized to
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

/** Mirrors the dashboard's greeting/pace card + 4-tile stat grid. */
export function DashboardSkeleton() {
  return (
    <main
      className="app-main"
      style={{ paddingBottom: 64 }}
      role="status"
      aria-label="Loading dashboard"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card flush">
          <div className="greeting">
            <Skeleton className="skel-circle" style={{ width: 44, height: 44 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton style={{ width: "55%", height: 16, marginBottom: 6 }} />
              <Skeleton style={{ width: "35%", height: 13 }} />
            </div>
          </div>
          <div style={{ height: 1, background: "var(--line)", margin: "0 16px" }} />
          <div className="pace">
            <Skeleton style={{ width: "40%", height: 14 }} />
            <Skeleton style={{ width: "60%", height: 22 }} />
            <Skeleton style={{ width: "100%", height: 12, borderRadius: 999 }} />
          </div>
        </div>

        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`stat${i === 0 ? " today-card" : ""}`}>
              <Skeleton style={{ width: "50%", height: 11, marginBottom: 8 }} />
              <Skeleton style={{ width: "70%", height: 26 }} />
            </div>
          ))}
        </div>

        <div>
          <Skeleton style={{ width: 120, height: 12, marginBottom: 8 }} />
          <RoListSkeleton rows={3} />
        </div>

        <ChartSkeleton />
      </div>
    </main>
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
        <Skeleton style={{ width: "100%", height: 130, borderRadius: "var(--radius-sm)" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <Skeleton style={{ width: 70, height: 13 }} />
          <Skeleton style={{ width: 90, height: 13 }} />
        </div>
      </div>
    </section>
  );
}
