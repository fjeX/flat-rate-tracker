import { Skeleton } from "@/components/ui/Skeleton";

// The shape of the Pay Period page, in the same order and the same widths:
// title and marker, the picker row, then two columns of zones. The left column
// is the totals zone (headline panel, one row, the four-cell spec row) and the
// two folds; the right column is the reference fold and the RO tags. Below the
// two-column breakpoint the columns stack, exactly as the page does.
function ZoneTab({ width }: { width: number }) {
  return <Skeleton style={{ width, height: 26, borderRadius: "0 0 var(--r-sign) var(--r-sign)" }} />;
}

export default function PayPeriodLoading() {
  return (
    <main className="pp-page" role="status" aria-label="Loading pay period">
      <div className="pp-head">
        <div className="pp-grow">
          <Skeleton style={{ width: 150, height: 28 }} />
        </div>
        <Skeleton style={{ width: 150, height: 24 }} />
      </div>
      <div className="pp-skel-picker">
        <Skeleton style={{ height: "var(--field-h)" }} />
        <Skeleton style={{ height: "var(--field-h)" }} />
        <Skeleton style={{ height: "var(--field-h)" }} />
      </div>
      <div className="pp-picker-more">
        <Skeleton style={{ width: 150, height: "var(--tap)" }} />
      </div>

      <div className="pp-grid">
        <div>
          <div className="zone">
            <div className="zone-head">
              <ZoneTab width={130} />
            </div>
            <Skeleton style={{ width: "100%", height: 96, borderRadius: "0 0 var(--r-sign) var(--r-sign)" }} />
            <Skeleton style={{ width: "100%", height: 48, marginTop: "var(--s1)" }} />
            <Skeleton style={{ width: "100%", height: 72, marginTop: "var(--s2)" }} />
          </div>
          <div className="zone">
            <div className="zone-head">
              <ZoneTab width={120} />
            </div>
            <div className="pp-skel-stack">
              <Skeleton style={{ width: "100%", height: 56 }} />
              <Skeleton style={{ width: "100%", height: 56 }} />
            </div>
          </div>
        </div>

        <div>
          <div className="zone">
            <div className="zone-head">
              <ZoneTab width={100} />
            </div>
            <Skeleton style={{ width: "100%", height: 56 }} />
          </div>
          <div className="zone">
            <div className="zone-head">
              <ZoneTab width={170} />
            </div>
            <ul className="pp-skel-tags">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i}>
                  <Skeleton style={{ width: "100%", height: 104 }} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
