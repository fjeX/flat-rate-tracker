import Link from "next/link";
import type { Entry } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";

export function RecentRoList({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p className="text-sm text-zinc-400">No ROs logged yet.</p>
        <Link
          href="/log"
          className="mt-2 inline-block text-sm font-medium text-orange-400 hover:text-orange-300"
        >
          Log your first RO →
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
      {entries.map((e) => {
        const vehicle = [e.vehicle.year, e.vehicle.make, e.vehicle.model]
          .filter(Boolean)
          .join(" ")
          .trim();
        return (
          <li key={e.id}>
            <Link
              href={`/log?edit=${e.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-orange-400">
                    #{e.roNumber}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDateShort(e.date)}
                  </span>
                </div>
                {vehicle && (
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {vehicle}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-zinc-100">
                  {fmtHours(e.flagHours)}h
                </div>
                <div className="text-xs text-zinc-500">
                  {e.opCodes.length}{" "}
                  {e.opCodes.length === 1 ? "job" : "jobs"}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
