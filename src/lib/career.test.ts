import { describe, it, expect } from "vitest";
import {
  CAREER_MILESTONES,
  careerMilestonesHit,
  careerRoadPosition,
  careerRoadStops,
  nextCareerMilestone,
  nextSnapshotThreshold,
  snapshotThresholdsReached,
} from "./career";

describe("career milestones", () => {
  it("next milestone walks the ladder", () => {
    expect(nextCareerMilestone(0)).toBe(100);
    expect(nextCareerMilestone(99.9)).toBe(100);
    expect(nextCareerMilestone(100)).toBe(500);
    expect(nextCareerMilestone(1248.6)).toBe(5000);
    expect(nextCareerMilestone(10000)).toBe(null);
  });

  it("hit list is every crossed threshold", () => {
    expect(careerMilestonesHit(0)).toEqual([]);
    expect(careerMilestonesHit(1248.6)).toEqual([100, 500, 1000]);
    expect(careerMilestonesHit(10000)).toEqual(CAREER_MILESTONES);
  });
});

describe("career road geometry", () => {
  it("stops are evenly spaced inside the edges, in ladder order", () => {
    const stops = careerRoadStops();
    expect(stops.map((s) => s.threshold)).toEqual(CAREER_MILESTONES);
    expect(stops[0].x).toBeCloseTo(0.03);
    expect(stops[stops.length - 1].x).toBeCloseTo(0.97);
    // strictly increasing
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].x).toBeGreaterThan(stops[i - 1].x);
    }
  });

  it("pin interpolates between neighboring stops", () => {
    const stops = careerRoadStops();
    expect(careerRoadPosition(0)).toBe(0);
    // Exactly on a stop
    expect(careerRoadPosition(500)).toBeCloseTo(stops[1].x);
    // Halfway between 500 and 1000 in hours = halfway between their x's
    expect(careerRoadPosition(750)).toBeCloseTo((stops[1].x + stops[2].x) / 2);
    // Before the first stop scales from 0
    expect(careerRoadPosition(50)).toBeCloseTo(stops[0].x / 2);
    // Past the end clamps to the last stop
    expect(careerRoadPosition(999999)).toBeCloseTo(stops[stops.length - 1].x);
  });
});

describe("snapshot schedule", () => {
  it("front-loads early unlocks then settles into every 100", () => {
    expect(snapshotThresholdsReached(9)).toEqual([]);
    expect(snapshotThresholdsReached(10)).toEqual([10]);
    expect(snapshotThresholdsReached(132)).toEqual([10, 25, 50, 100]);
    expect(snapshotThresholdsReached(305)).toEqual([10, 25, 50, 100, 200, 300]);
  });

  it("next threshold matches the same schedule", () => {
    expect(nextSnapshotThreshold(0)).toBe(10);
    expect(nextSnapshotThreshold(10)).toBe(25);
    expect(nextSnapshotThreshold(132)).toBe(200);
    expect(nextSnapshotThreshold(200)).toBe(300);
    expect(nextSnapshotThreshold(305)).toBe(400);
  });
});
