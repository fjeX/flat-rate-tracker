// Career odometer + portfolio snapshot schedule (gamification Phase 1).
//
// The odometer is the lifetime sum of flag hours — derived, never stored.
// Milestones are earned-once rows (career_milestones) so a later RO
// correction can lower the displayed total but never un-ring the bell.
//
// Snapshot thresholds are front-loaded so a new user's first unlock lands in
// week one, then settle into every 100 ROs.

/** Lifetime flag-hour milestones, in order. */
export const CAREER_MILESTONES = [100, 500, 1000, 5000, 10000];

/** First milestone above the current total, or null past the ladder. */
export function nextCareerMilestone(totalHours: number): number | null {
  return CAREER_MILESTONES.find((m) => totalHours < m) ?? null;
}

/** Milestones the total has crossed (for earned-once upserts + road pins). */
export function careerMilestonesHit(totalHours: number): number[] {
  return CAREER_MILESTONES.filter((m) => totalHours >= m);
}

/**
 * Road geometry: milestone stops are spaced evenly along the track (a linear
 * hour scale would crush 100/500/1k into the first 10%), pinned inside
 * [EDGE, 1 - EDGE] so the end labels don't clip.
 */
const ROAD_EDGE = 0.03;

export function careerRoadStops(): { threshold: number; x: number }[] {
  const n = CAREER_MILESTONES.length;
  return CAREER_MILESTONES.map((threshold, i) => ({
    threshold,
    x: ROAD_EDGE + (i / (n - 1)) * (1 - 2 * ROAD_EDGE),
  }));
}

/** Pin position (0..1): linear interpolation between neighboring stops. */
export function careerRoadPosition(totalHours: number): number {
  const stops = careerRoadStops();
  if (totalHours <= 0) return 0;
  // Before the first stop: 0 → first milestone maps onto 0 → first x.
  if (totalHours < stops[0].threshold) {
    return (totalHours / stops[0].threshold) * stops[0].x;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (totalHours < b.threshold) {
      const f = (totalHours - a.threshold) / (b.threshold - a.threshold);
      return a.x + f * (b.x - a.x);
    }
  }
  return stops[stops.length - 1].x;
}

// ---------------------------------------------------------------------------
// Portfolio snapshot schedule
// ---------------------------------------------------------------------------

const SNAPSHOT_EARLY = [10, 25, 50, 100];
const SNAPSHOT_STEP = 100;

/** Every threshold at or below `roCount`, in unlock order. */
export function snapshotThresholdsReached(roCount: number): number[] {
  const out = SNAPSHOT_EARLY.filter((t) => t <= roCount);
  for (
    let t = SNAPSHOT_EARLY[SNAPSHOT_EARLY.length - 1] + SNAPSHOT_STEP;
    t <= roCount;
    t += SNAPSHOT_STEP
  ) {
    out.push(t);
  }
  return out;
}

/** The next unlock line above `roCount`. */
export function nextSnapshotThreshold(roCount: number): number {
  const early = SNAPSHOT_EARLY.find((t) => t > roCount);
  if (early !== undefined) return early;
  const last = SNAPSHOT_EARLY[SNAPSHOT_EARLY.length - 1];
  return last + SNAPSHOT_STEP * (Math.floor((roCount - last) / SNAPSHOT_STEP) + 1);
}

/**
 * Deterministic display number for a threshold: its 1-based position in the
 * unlock schedule (10 → #1, 25 → #2, 50 → #3, 100 → #4, 200 → #5, …).
 * Deterministic so concurrent generators can never disagree on seq.
 */
export function snapshotSeqForThreshold(threshold: number): number {
  const early = SNAPSHOT_EARLY.indexOf(threshold);
  if (early !== -1) return early + 1;
  const last = SNAPSHOT_EARLY[SNAPSHOT_EARLY.length - 1];
  if (threshold <= last || (threshold - last) % SNAPSHOT_STEP !== 0) {
    throw new Error(`Not a snapshot threshold: ${threshold}`);
  }
  return SNAPSHOT_EARLY.length + (threshold - last) / SNAPSHOT_STEP;
}
