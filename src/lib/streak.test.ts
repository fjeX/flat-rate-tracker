import { describe, it, expect } from "vitest";
import {
  computeStreak,
  expandDaysOff,
  gaugeMarks,
  STREAK_MILESTONES,
} from "./streak";
import { addDays } from "./periods";

// ------------------------------------------------------------------------
// Fixtures — 2026-06-08 is a Monday (verified in periods.test.ts), so
// weekdays are known without Date lookups in the tests themselves.
// ------------------------------------------------------------------------

/** Mon–Fri dates for `weeks` full weeks starting at monday. */
function weekdaysFrom(monday: string, weeks: number): string[] {
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) out.push(addDays(monday, w * 7 + d));
  }
  return out;
}

const MON = "2026-06-08"; // Monday anchor

describe("computeStreak", () => {
  it("returns zeros with no logs", () => {
    const r = computeStreak({ loggedDates: [], daysOff: [], today: MON });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
    expect(r.todayLogged).toBe(false);
    expect(r.nextMilestone).toBe(STREAK_MILESTONES[0]);
  });

  it("counts consecutive logged work days; weekends never break", () => {
    // 4 full Mon–Fri weeks = 20 logged days, today = last Friday
    const logged = weekdaysFrom(MON, 4);
    const today = logged[logged.length - 1];
    const r = computeStreak({ loggedDates: logged, daysOff: [], today });
    expect(r.current).toBe(20);
    expect(r.longest).toBe(20);
    expect(r.todayLogged).toBe(true);
  });

  it("does not break on today while today is unlogged", () => {
    const logged = weekdaysFrom(MON, 4); // ends Friday 2026-07-03
    const lastFri = logged[logged.length - 1];
    const nextMon = addDays(lastFri, 3);
    const r = computeStreak({ loggedDates: logged, daysOff: [], today: nextMon });
    expect(r.current).toBe(20); // Monday isn't over yet — frozen, not broken
    expect(r.todayLogged).toBe(false);
  });

  it("one missed expected day is grace-frozen; two consecutive break", () => {
    const four = weekdaysFrom(MON, 4); // establishes Mon–Fri expectation
    const lastFri = four[four.length - 1];

    // Miss Monday only, log Tuesday, today = Tuesday.
    const tue = addDays(lastFri, 4);
    let r = computeStreak({
      loggedDates: [...four, tue],
      daysOff: [],
      today: tue,
    });
    expect(r.current).toBe(21); // 20 + Tuesday; Monday was grace

    // Miss Monday AND Tuesday, today = Wednesday (unlogged).
    const wed = addDays(lastFri, 5);
    r = computeStreak({ loggedDates: four, daysOff: [], today: wed });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(20); // high-water mark survives the break
  });

  it("explicit days off freeze even an expected work week", () => {
    const four = weekdaysFrom(MON, 4);
    const lastFri = four[four.length - 1];
    // Whole next week off, then log the Monday after.
    const vacStart = addDays(lastFri, 3);
    const vacEnd = addDays(lastFri, 7);
    const backMon = addDays(lastFri, 10);
    const r = computeStreak({
      loggedDates: [...four, backMon],
      daysOff: [{ startDate: vacStart, endDate: vacEnd }],
      today: backMon,
    });
    expect(r.current).toBe(21); // vacation frozen, streak resumed
  });

  it("new user with sparse history never breaks (nothing expected yet)", () => {
    // Logged 3 scattered days over two weeks — far too little pattern.
    const logged = [MON, addDays(MON, 3), addDays(MON, 8)];
    const today = addDays(MON, 11);
    const r = computeStreak({ loggedDates: logged, daysOff: [], today });
    expect(r.current).toBe(3); // every gap frozen, all logs count
  });

  it("part-time pattern: never-worked weekdays are not expected", () => {
    // Tue/Thu tech for 5 weeks; Mondays never worked → never break.
    const logged: string[] = [];
    for (let w = 0; w < 5; w++) {
      logged.push(addDays(MON, w * 7 + 1)); // Tue
      logged.push(addDays(MON, w * 7 + 3)); // Thu
    }
    const today = logged[logged.length - 1];
    const r = computeStreak({ loggedDates: logged, daysOff: [], today });
    expect(r.current).toBe(10);
  });

  it("future-dated ROs are ignored", () => {
    const r = computeStreak({
      loggedDates: [MON, addDays(MON, 30)],
      daysOff: [],
      today: addDays(MON, 1),
    });
    expect(r.current).toBe(1);
  });

  it("milestone helpers track the ladder", () => {
    const four = weekdaysFrom(MON, 4);
    const today = four[four.length - 1];
    const r = computeStreak({ loggedDates: four, daysOff: [], today });
    expect(r.current).toBe(20);
    expect(r.milestonesHit).toEqual([5, 10, 15]);
    expect(r.nextMilestone).toBe(30);
  });
});

describe("expandDaysOff", () => {
  it("expands inclusive ranges", () => {
    const s = expandDaysOff([{ startDate: MON, endDate: addDays(MON, 2) }]);
    expect(s.size).toBe(3);
    expect(s.has(MON)).toBe(true);
    expect(s.has(addDays(MON, 2))).toBe(true);
  });
});

describe("gaugeMarks", () => {
  it("windows the ladder around the current streak", () => {
    expect(gaugeMarks(0)).toEqual([5, 10, 15, 30]);
    expect(gaugeMarks(12)).toEqual([5, 10, 15, 30]);
    expect(gaugeMarks(40)).toEqual([15, 30, 50, 75]);
    expect(gaugeMarks(999)).toEqual(STREAK_MILESTONES.slice(-4));
  });
});
