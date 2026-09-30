// @vitest-environment jsdom
//
// The pace track. Two things matter: every number that was on the old pace card
// is still printed exactly once (flag hours, goal, percent of goal, days left,
// the projection), and the tick labels under the track never sit on top of
// each other, however close to either end the fill is.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { PaceZone, paceTicks } from "./PaceZone";

afterEach(cleanup);

const labels = (frac: number, goal = 45) => paceTicks(frac, goal).map((t) => t.label);

describe("paceTicks", () => {
  it("prints 0, the percent at the end of the fill, and the goal", () => {
    expect(labels(0.6)).toEqual(["0", "60%", "Goal 45"]);
  });

  it("folds the percent into the goal before it can reach the wider goal label", () => {
    // "Goal 45" is ~60px; a centred "80%" at phone width would run into it.
    expect(labels(0.8)).toEqual(["0", "Goal 45 · 80%"]);
  });

  it("drops the 0 when the fill is too close to the start to fit it", () => {
    expect(labels(0.03)).toEqual(["3%", "Goal 45"]);
  });

  it("folds the percent into the goal when the fill reaches the end", () => {
    expect(labels(0.95)).toEqual(["0", "Goal 45 · 95%"]);
  });

  it("reports the real percent past the goal, not a clamped one", () => {
    expect(labels(1.12)).toEqual(["0", "Goal 45 · 112%"]);
    // ...but the tick sits at the end of the track
    expect(paceTicks(1.12, 45).at(-1)?.left).toBe(100);
  });
});

const PROPS = {
  flagHours: 36,
  goalHours: 45,
  hasGoal: true,
  actualFrac: 0.8,
  paceTarget: 0.6,
  daysLeft: 6,
  periodLabel: "Mar 1 – Mar 15",
  forecastLine: "On pace for about 44 of 45 flag hrs",
  requiredLine: "Flag about 4.5 more hrs/day across your 2 working days left to reach 45.",
  dayText: null,
};

describe("PaceZone", () => {
  it("prints the flag hours, the period, the days left and both projection lines", () => {
    render(<PaceZone {...PROPS} />);
    const text = document.body.textContent ?? "";
    expect(document.querySelector(".bigline .sr-only")?.textContent).toBe("36.0");
    expect(text).toContain("Mar 1 – Mar 15 · 6 days left");
    expect(text).toContain(PROPS.forecastLine);
    expect(text).toContain(PROPS.requiredLine);
  });

  it("marks today and the goal on the track, and describes it in words", () => {
    render(<PaceZone {...PROPS} />);
    const track = document.querySelector(".track");
    expect(track?.getAttribute("role")).toBe("img");
    expect(track?.getAttribute("aria-label")).toContain("36.0 of 45 flag hours, 80 percent of goal");
    expect(track?.querySelector(".mk.now")?.textContent).toBe("Today");
    expect(track?.querySelector(".mk.now")?.getAttribute("style")).toContain("left: 60%");
    // The goal is marked on the track but labelled in the tick row below it,
    // so late in the period Today (above) and Goal (below) can never overlap:
    // day 14 of 15 printed "TODAY" over "GOAL 88" (Liem, 2026-09-30).
    expect(track?.querySelector(".mk.end")).toBeTruthy();
    expect(track?.querySelector(".mk.end")?.textContent).toBe("");
    expect(document.querySelector(".ticks .last")?.textContent).toBe("Goal 45 · 80%");
  });

  it("clamps the fill at the end of the track but keeps the real number", () => {
    render(<PaceZone {...PROPS} flagHours={54} actualFrac={1.2} />);
    expect(document.querySelector(".track .fill")?.getAttribute("style")).toContain("width: 100%");
    expect(document.querySelector(".track")?.getAttribute("aria-label")).toContain("120 percent");
  });

  it("says 'Day N / M' only when it is told the percentage is withheld", () => {
    render(<PaceZone {...PROPS} dayText="Day 9 / 15" />);
    expect(document.querySelector(".bigline .end")?.textContent).toContain("Day 9 / 15");
    cleanup();
    render(<PaceZone {...PROPS} />);
    expect(document.querySelector(".bigline .end")?.textContent).not.toContain("Day");
  });

  it("singularises the last day", () => {
    render(<PaceZone {...PROPS} daysLeft={1} />);
    expect(document.querySelector(".bigline .end")?.textContent).toContain("1 day left");
  });

  it("draws no goal marker, scale or projection when no goal is set", () => {
    render(<PaceZone {...PROPS} goalHours={0} hasGoal={false} actualFrac={0} forecastLine="" requiredLine="" />);
    expect(document.querySelector(".mk.end")).toBeNull();
    expect(document.querySelector(".ticks")).toBeNull();
    expect(document.querySelector(".pace-words")).toBeNull();
  });

  it("links to the Pay Period page", () => {
    render(<PaceZone {...PROPS} />);
    expect(document.querySelector(".zone-link")?.getAttribute("href")).toBe("/pay-period");
  });
});
