import { RoListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function PayPeriodLoading() {
  return (
    <main
      className="mx-auto max-w-5xl space-y-4 p-4 pb-16"
      role="status"
      aria-label="Loading pay period"
    >
      <Skeleton style={{ width: 140, height: 24 }} />
      <div className="card padded space-y-3">
        <Skeleton style={{ width: "100%", height: 38, borderRadius: 10 }} />
        <Skeleton style={{ width: 160, height: 30, borderRadius: 8 }} />
      </div>
      <div className="card padded">
        <Skeleton style={{ width: "60%", height: 20, marginBottom: 10 }} />
        <Skeleton style={{ width: "100%", height: 80 }} />
      </div>
      <RoListSkeleton rows={5} />
    </main>
  );
}
