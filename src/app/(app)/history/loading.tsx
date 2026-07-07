import { ChartSkeleton, RoListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function HistoryLoading() {
  return (
    <main
      className="app-main"
      style={{ paddingBottom: 64 }}
      role="status"
      aria-label="Loading history"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="filter-row" style={{ margin: 0, padding: 0 }}>
          {[64, 56, 64, 68, 52].map((w, i) => (
            <Skeleton key={i} style={{ width: w, height: 30, borderRadius: 999, flexShrink: 0 }} />
          ))}
        </div>
        <ChartSkeleton />
        <RoListSkeleton rows={6} />
      </div>
    </main>
  );
}
