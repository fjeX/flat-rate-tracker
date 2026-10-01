import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

// Mirrors the dashboard's final layout so nothing jumps when the page lands:
// page head, then two columns on desktop (Today, pace, flagged to date, streak
// on the left; recent ROs and the chart on the right), one column on a phone.
// Every block is sized to the thing it stands in for. Same class names as the
// page (dash-page, dash, zone, zone-head), so the same CSS lays it out.

function ZoneSkeleton({ nameWidth, children }: { nameWidth: number; children: ReactNode }) {
  return (
    <div className="zone">
      <div className="zone-head">
        <Skeleton style={{ width: nameWidth, height: 24 }} />
      </div>
      {children}
    </div>
  );
}

function TagSkeleton() {
  return (
    <div className="tag-skel">
      <Skeleton style={{ width: "42%", height: 16, marginTop: 14 }} />
      <Skeleton style={{ width: "58%", height: 14, marginTop: 14 }} />
      <Skeleton style={{ width: "36%", height: 10, marginTop: 14 }} />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <main className="dash-page" role="status" aria-label="Loading dashboard">
      <div className="pagehead">
        <Skeleton style={{ width: 40, height: 40, flex: "none" }} />
        <div className="grow">
          <Skeleton style={{ width: "55%", height: 26, marginBottom: 6 }} />
          <Skeleton style={{ width: "35%", height: 13 }} />
        </div>
      </div>

      <div className="dash">
        <div>
          <ZoneSkeleton nameWidth={72}>
            <Skeleton style={{ width: "100%", height: 100 }} />
            <div className="today-tools">
              <Skeleton style={{ height: 70 }} />
              <Skeleton style={{ height: 48, alignSelf: "end" }} />
            </div>
          </ZoneSkeleton>

          <ZoneSkeleton nameWidth={150}>
            <Skeleton style={{ width: "45%", height: 30, marginBottom: 32 }} />
            <Skeleton style={{ width: "100%", height: 14 }} />
            <Skeleton style={{ width: "60%", height: 16, marginTop: 34 }} />
            <Skeleton style={{ width: "80%", height: 13, marginTop: 8 }} />
          </ZoneSkeleton>

          <ZoneSkeleton nameWidth={140}>
            <Skeleton style={{ width: "100%", height: 168 }} />
          </ZoneSkeleton>

          <ZoneSkeleton nameWidth={200}>
            <Skeleton style={{ width: "100%", height: 76, marginBottom: 12 }} />
            <Skeleton style={{ width: "100%", height: 76, marginBottom: 12 }} />
            <Skeleton style={{ width: "100%", height: 76 }} />
          </ZoneSkeleton>
        </div>

        <div>
          <ZoneSkeleton nameWidth={110}>
            <div className="tags">
              {[0, 1, 2, 3].map((i) => (
                <TagSkeleton key={i} />
              ))}
            </div>
          </ZoneSkeleton>

          <ZoneSkeleton nameWidth={130}>
            <Skeleton style={{ width: "100%", height: 48 }} />
            <Skeleton style={{ width: "40%", height: 30, marginTop: 12 }} />
            <Skeleton style={{ width: "100%", height: 152, marginTop: 24 }} />
          </ZoneSkeleton>
        </div>
      </div>
    </main>
  );
}
