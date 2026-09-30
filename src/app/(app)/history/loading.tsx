import { Skeleton } from "@/components/ui/Skeleton";

// The shape of HistoryView while the page loads: title, the two controls,
// the chart zone, then a few tags.
export default function HistoryLoading() {
  return (
    <main className="hist-page" role="status" aria-label="Loading history">
      <div className="pagehead">
        <div className="grow">
          <Skeleton style={{ width: 120, height: 26, marginBottom: 6 }} />
          <Skeleton style={{ width: 180, height: 13 }} />
        </div>
      </div>
      <div className="hist-ctl">
        <Skeleton style={{ width: "100%", maxWidth: 360, height: 44 }} />
        <div className="hist-ctl-row">
          <Skeleton style={{ width: 200, height: 44 }} />
          <Skeleton style={{ flex: "1 1 14rem", height: 48 }} />
        </div>
      </div>
      <div className="hist-grid">
        <section className="zone">
          <Skeleton style={{ width: 110, height: 13, marginBottom: 12 }} />
          <Skeleton style={{ width: "45%", height: 28, marginBottom: 24 }} />
          <Skeleton style={{ width: "100%", height: 152 }} />
        </section>
        <section className="zone">
          <Skeleton style={{ width: 120, height: 13, marginBottom: 12 }} />
          <ul className="hist-skel-tags">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="tag-skel" />
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
