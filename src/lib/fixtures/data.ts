/**
 * The frozen world the visual suite snapshots.
 *
 * Every value here is a literal or derived from one — no Date.now(), no
 * Math.random(), no reads of the environment. Same bytes on every run, on every
 * machine. That property is the entire point: if this file can drift, the
 * baselines drift with it and we're back to the problem we set out to fix.
 *
 * SHAPE CONTRACT
 * Rows must match src/lib/supabase/database.types.ts exactly, because the real
 * db/*.ts mappers (toEntry etc.) run against them unchanged. A missing column
 * doesn't throw — it renders as undefined, which is a subtly wrong snapshot
 * rather than a loud failure. Add columns here when the schema gains them.
 *
 * COVERAGE OVER REALISM
 * The dataset is picked to exercise layout, not to look plausible: a comeback, a
 * multi-line RO, a zero-hour day, a long op-code description that wraps, and a
 * note long enough to clamp. Pretty data snapshots pretty and catches nothing.
 */
import { FIXTURE_NOW_ISO } from "./enabled";

export const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000001";
export const FIXTURE_EMAIL = "bot@slimelab.cc";

/** Deterministic stand-in for a UUID — readable in a diff, stable across runs. */
const id = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`.slice(0, 36);

const STAMP = FIXTURE_NOW_ISO;

// ── op codes ────────────────────────────────────────────────────────────────
// sort_order is explicit and gap-free; the op-codes list renders in this order
// and a drag-reorder regression shows up as a reordered snapshot.
const OP_CODES = [
  ["LOF", "Lube, oil & filter", 0.5, ["maintenance"], 0],
  ["TR4", "Tire rotation, 4 wheels", 0.4, ["maintenance", "tires"], 1],
  ["BRK-F", "Brake pads & rotors, front axle", 1.8, ["brakes"], 2],
  ["BRK-R", "Brake pads & rotors, rear axle", 1.6, ["brakes"], 3],
  ["ALIGN", "Four wheel alignment with printout", 1.0, ["tires"], 4],
  ["BATT", "Battery test and replacement", 0.6, ["electrical"], 5],
  ["DIAG-1", "Diagnostic, one hour — customer concern verification and scan", 1.0, ["diag"], 6],
  ["AC-EVAC", "A/C evacuate and recharge, includes dye and leak inspection", 1.4, ["hvac"], 7],
] as const;

export const opCodes = OP_CODES.map(([code, description, flag_hours, tags, sort_order], i) => ({
  id: id("0c9f97", i),
  user_id: FIXTURE_USER_ID,
  code,
  description,
  flag_hours,
  tags: [...tags],
  sort_order,
  notes: "",
  created_at: STAMP,
}));

// ── entries ─────────────────────────────────────────────────────────────────
// Fixed working days from 2026-01-05 through 2026-03-11 (the frozen "today" is
// 2026-03-12), which is deep enough to fill the 90-day windows on /dashboard and
// /insights and to give /history more than one month to group.
const VEHICLES = [
  ["2019", "Toyota", "Camry", "4T1B11HK9KU123456", "84210"],
  ["2021", "Honda", "CR-V", "2HKRW2H85MH654321", "41880"],
  ["2017", "Ford", "F-150", "1FTEW1EP2HFA98765", "132455"],
  ["2020", "Subaru", "Outback", "4S4BSANC1L3246810", "67320"],
  ["2022", "Tesla", "Model 3", "5YJ3E1EA7NF135790", "22105"],
  ["2015", "Chevrolet", "Silverado", "3GCUKREC0FG864209", "188740"],
] as const;

/** Working days, oldest first. Weekends and two deliberate zero-days omitted. */
const WORK_DAYS: string[] = (() => {
  const out: string[] = [];
  // January 5 (Mon) → March 11, weekdays only. Built by index arithmetic off a
  // fixed epoch so no wall clock is ever consulted.
  const start = Date.UTC(2026, 0, 5);
  for (let d = 0; d < 66; d++) {
    const t = start + d * 86_400_000;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
})();

type FixtureOpLine = {
  id: string;
  entry_id: string;
  op_code_id: string | null;
  sub_op_code_id: string | null;
  custom: boolean;
  custom_code: string | null;
  custom_description: string | null;
  flag_hours: number;
  actual_hours: number | null;
  paid_hours: number | null;
  labor_type: string | null;
  is_comeback: boolean;
  is_upsell: boolean;
  notes: string;
  position: number;
};

const entryRows: Record<string, unknown>[] = [];
const opLineRows: FixtureOpLine[] = [];

let roSeq = 0;
let lineSeq = 0;

// Wall-clock "HH:MM" for an RO, spread deterministically across a shift so the
// list rows show a plausible sequence of jobs rather than the same time repeated.
// Zero-padded and inside 08:00–15:59, which is what the column's CHECK accepts.
const loggedTimeFor = (seq: number) =>
  `${String(8 + (seq % 8)).padStart(2, "0")}:${String((seq * 7) % 60).padStart(2, "0")}`;

WORK_DAYS.forEach((date, dayIx) => {
  // 1–3 ROs per day, cycling deterministically. Day 9 gets zero ROs on purpose:
  // an empty working day is a real layout case (the "no ROs logged" row).
  const count = dayIx % 11 === 9 ? 0 : (dayIx % 3) + 1;

  for (let k = 0; k < count; k++) {
    const entryId = id("e17a", roSeq);
    const [vehicle_year, vehicle_make, vehicle_model, vehicle_vin, vehicle_mileage] =
      VEHICLES[roSeq % VEHICLES.length];

    // Line count cycles 1→3 so the RO cards exercise single- and multi-line layout.
    const lines = (roSeq % 3) + 1;
    let flagTotal = 0;

    for (let l = 0; l < lines; l++) {
      const op = opCodes[(roSeq + l) % opCodes.length];
      const flag = op.flag_hours;
      flagTotal += flag;
      // Every 17th RO is a comeback — rare enough to be realistic, frequent
      // enough that the comeback badge lands in at least one snapshot.
      const isComeback = roSeq % 17 === 16 && l === 0;
      opLineRows.push({
        id: id("11ce", lineSeq++),
        entry_id: entryId,
        op_code_id: op.id,
        sub_op_code_id: null,
        custom: false,
        custom_code: null,
        custom_description: null,
        flag_hours: flag,
        actual_hours: null,
        paid_hours: null,
        labor_type: l === 0 ? "customer_pay" : "warranty",
        is_comeback: isComeback,
        // The upsell is the LAST line — the shape a real one takes, added to a
        // ticket after the customer approved it. Roughly one RO in five, which
        // puts the Upsold tile on /pay-period and a populated "What you sold"
        // on /insights in front of the camera instead of their empty states.
        //
        // Guarded against the comeback line: the DB CHECK forbids both, and a
        // fixture that produces a row the database would refuse is a fixture
        // photographing something that cannot exist.
        is_upsell: !isComeback && roSeq % 5 === 2 && l === lines - 1,
        notes: "",
        position: l,
      });
    }

    entryRows.push({
      id: entryId,
      user_id: FIXTURE_USER_ID,
      // 9099xxxxx is the band the write-smoke reserves for synthetic ROs, so a
      // fixture RO is never mistaken for a real one if this data ever leaks.
      ro_number: `9099${String(10_000 + roSeq).slice(-5)}`,
      date,
      // Most ROs carry one; every 6th deliberately does not, so the "no time
      // recorded" row — the shape of every RO logged before the feature — is
      // photographed beside the ones that do.
      logged_time: roSeq % 6 === 5 ? null : loggedTimeFor(roSeq),
      flag_hours: Number(flagTotal.toFixed(2)),
      vehicle_year,
      vehicle_make,
      vehicle_model,
      vehicle_vin,
      vehicle_mileage,
      // One long note so the clamp/ellipsis path is covered.
      notes:
        roSeq % 8 === 3
          ? "Customer states intermittent grinding from the front end under light braking, worse when cold. Verified on road test, measured pad thickness at 2mm inner. Advised rotor replacement, customer declined rear axle."
          : "",
      comeback_of_entry_id: null,
      comeback_kind: null,
      created_at: `${date}T16:00:00.000Z`,
      updated_at: `${date}T16:00:00.000Z`,
    });
    roSeq++;
  }
});

// ── the unpaired day ────────────────────────────────────────────────────────
// A Saturday: flagged work, no clock entry, and no scheduled shift (the pattern
// below is Mon–Fri). The app therefore cannot tell how long that day was, so
// these hours land in the flagged total but in NEITHER side of the efficiency
// percentage, and PeriodStats renders its "Not counted above" caption to say so.
//
// This day exists to put that caption in front of the camera. Without it every
// fixture day is clocked, unpairedFlagHours is 0, the caption never renders, and
// the branch of stats.ts that computes it is dark to the visual suite — which is
// exactly how it shipped unphotographed on 2026-08-14. It sits inside the
// 2026-03-01..15 period so /pay-period picks it up, and before the frozen today.
const UNPAIRED_DAY = "2026-03-07"; // Saturday
{
  const entryId = id("e17a", roSeq);
  const [vehicle_year, vehicle_make, vehicle_model, vehicle_vin, vehicle_mileage] =
    VEHICLES[roSeq % VEHICLES.length];
  const picks = [opCodes[2], opCodes[4]]; // BRK-F 1.8 + ALIGN 1.0 = 2.8 flagged
  let flagTotal = 0;

  picks.forEach((op, l) => {
    flagTotal += op.flag_hours;
    opLineRows.push({
      id: id("11ce", lineSeq++),
      entry_id: entryId,
      op_code_id: op.id,
      sub_op_code_id: null,
      custom: false,
      custom_code: null,
      custom_description: null,
      flag_hours: op.flag_hours,
      actual_hours: null,
      paid_hours: null,
      labor_type: "customer_pay",
      is_comeback: false,
      is_upsell: false,
      notes: "",
      position: l,
    });
  });

  entryRows.push({
    id: entryId,
    user_id: FIXTURE_USER_ID,
    ro_number: `9099${String(10_000 + roSeq).slice(-5)}`,
    date: UNPAIRED_DAY,
    logged_time: loggedTimeFor(roSeq),
    flag_hours: Number(flagTotal.toFixed(2)),
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vehicle_vin,
    vehicle_mileage,
    notes: "Came in Saturday to finish the brake job — never clocked in.",
    comeback_of_entry_id: null,
    comeback_kind: null,
    created_at: `${UNPAIRED_DAY}T16:00:00.000Z`,
    updated_at: `${UNPAIRED_DAY}T16:00:00.000Z`,
  });
  roSeq++;
}

// entries are read with `.select("*, entry_op_codes(*)")` — the real mapper
// expects the relation embedded, so it's attached here rather than joined.
export const entries = entryRows.map((e) => ({
  ...e,
  entry_op_codes: opLineRows.filter((l) => l.entry_id === e.id),
}));

export const entryOpCodes = opLineRows;

// ── clock hours ─────────────────────────────────────────────────────────────
// Clocked hours per working day. Deliberately not a constant 8: efficiency is
// flagged/clocked, so a flat denominator would make every percentage identical
// and hide a broken calculation behind a plausible-looking number.
export const dailyClockHours = WORK_DAYS.map((date, i) => ({
  user_id: FIXTURE_USER_ID,
  date,
  hours: [8, 8, 7.5, 8, 9, 8, 6.5, 8][i % 8],
}));

// ── work schedule ───────────────────────────────────────────────────────────
// Mon–Fri, 08:00–17:00 with an unpaid hour = 8 paid hours, effective from the
// first fixture working day.
//
// This deliberately changes no existing number. Every weekday in the dataset
// already has a clock entry and clocked hours always win, so no day falls to the
// schedule fallback: the denominator, the efficiency and the "Clocked hrs"
// provenance label all stay exactly as they were. What it changes is WHICH
// aggregator runs — aggregateStatsAuto only reaches aggregateStatsWithSchedule
// when a schedule exists, and that is the only function that computes
// unpairedFlagHours. With no schedule here, the pay-period page ran plain
// aggregateStats and the entire schedule-aware branch went unphotographed.
const SHIFT_8 = { start: "08:00", end: "17:00", breakMin: 60 };
const WEEK_MON_FRI = {
  mon: SHIFT_8,
  tue: SHIFT_8,
  wed: SHIFT_8,
  thu: SHIFT_8,
  fri: SHIFT_8,
  sat: null,
  sun: null,
};

export const workSchedules = [
  {
    id: id("5c4e", 1),
    user_id: FIXTURE_USER_ID,
    effective_from: "2026-01-05", // Monday, the first fixture working day
    anchor_monday: "2026-01-05",
    rotation_weeks: 1,
    weeks: [WEEK_MON_FRI],
    created_at: STAMP,
  },
];

// ── settings & rates ────────────────────────────────────────────────────────
export const userSettings = {
  user_id: FIXTURE_USER_ID,
  goal_hours: 45,
  split_day: 15,
  reference_hourly_rate: 38,
  default_labor_type: "customer_pay",
  is_admin: false,
  share_labor_times: false,
  // ON, so the settings card photographs in its enabled state and the log form
  // shows its time field. The fixture clock is pinned (instrumentation.ts), so
  // the prefilled value is as deterministic as everything else here.
  track_ro_time: true,
  period_overrides: {},
  ro_template: null,
  tag_colors: {},
  updated_at: STAMP,
};

export const laborRates = [
  { id: id("1ab0", 1), user_id: FIXTURE_USER_ID, labor_type: "customer_pay", hourly_rate: 38, created_at: STAMP, updated_at: STAMP },
  { id: id("1ab0", 2), user_id: FIXTURE_USER_ID, labor_type: "warranty", hourly_rate: 32, created_at: STAMP, updated_at: STAMP },
];

/**
 * Table → rows. Anything absent resolves to an empty array, never an error.
 *
 * That default is deliberate. The five snapshot routes touch ~18 db functions
 * across 23 tables, and most of those surfaces render a legitimate empty state
 * (no disputes, no bonuses, no time off). Empty is as deterministic as populated
 * and costs nothing to maintain — so only tables whose empty state would hide
 * real layout are filled in above.
 */
export const TABLES: Record<string, unknown[]> = {
  entries,
  entry_op_codes: entryOpCodes,
  op_codes: opCodes,
  labor_rates: laborRates,
  daily_clock_hours: dailyClockHours,
  user_settings: [userSettings],
  work_schedules: workSchedules,
};
