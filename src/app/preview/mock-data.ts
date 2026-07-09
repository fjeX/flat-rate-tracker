// Static mock data for the /preview design-direction prototypes.
// Deliberately hand-written and realistic — no Supabase, no auth, no business logic.

export type MockLine = { code: string; desc: string; flag: number };

export type MockEntry = {
  ro: string;
  dateLine: string;
  vehicle: string;
  hours: number;
  lines: MockLine[];
  hasPhoto?: boolean;
};

export const ENTRIES: MockEntry[] = [
  {
    ro: "48291",
    dateLine: "Today · 2:14 PM",
    vehicle: "2021 Ford F-150",
    hours: 2.8,
    hasPhoto: true,
    lines: [
      { code: "BRKP2", desc: "Front pads + rotors", flag: 1.7 },
      { code: "LOF", desc: "Lube, oil & filter", flag: 0.3 },
      { code: "TIRE4", desc: "Rotate & balance", flag: 0.8 },
    ],
  },
  {
    ro: "48287",
    dateLine: "Today · 11:02 AM",
    vehicle: "2017 Toyota Camry",
    hours: 2.6,
    lines: [
      { code: "STRUTF", desc: "Front struts, pair", flag: 2.4 },
      { code: "BATT", desc: "Battery R&R + test", flag: 0.2 },
    ],
  },
  {
    ro: "48284",
    dateLine: "Today · 8:41 AM",
    vehicle: "2019 Honda Civic",
    hours: 1.0,
    lines: [{ code: "DIAG", desc: "Check engine light diag", flag: 1.0 }],
  },
  {
    ro: "48279",
    dateLine: "Yesterday · 4:48 PM",
    vehicle: "2022 Kia Sorento",
    hours: 1.2,
    hasPhoto: true,
    lines: [{ code: "ALIGN4", desc: "4-wheel alignment", flag: 1.2 }],
  },
  {
    ro: "48271",
    dateLine: "Yesterday · 1:30 PM",
    vehicle: "2015 Chevy Silverado 1500",
    hours: 3.8,
    lines: [{ code: "WPUMP", desc: "Water pump R&R", flag: 3.8 }],
  },
  {
    ro: "48265",
    dateLine: "Jul 6 · 3:22 PM",
    vehicle: "2020 Subaru Outback",
    hours: 1.5,
    lines: [
      { code: "COOLFL", desc: "Coolant flush", flag: 1.2 },
      { code: "LOF", desc: "Lube, oil & filter", flag: 0.3 },
    ],
  },
  {
    ro: "48260",
    dateLine: "Jul 6 · 10:15 AM",
    vehicle: "2018 BMW 328i",
    hours: 2.2,
    lines: [{ code: "OILHSG", desc: "Oil filter housing gasket", flag: 2.2 }],
  },
  {
    ro: "48254",
    dateLine: "Jul 5 · 2:57 PM",
    vehicle: "2019 Toyota RAV4",
    hours: 0.9,
    lines: [
      { code: "CABAIR", desc: "Cabin + engine air filters", flag: 0.5 },
      { code: "WIPER", desc: "Wiper inserts", flag: 0.4 },
    ],
  },
];

export const STATS = {
  today: { ros: 3, flag: 6.4, clocked: 7.5, eff: 85 },
  week: { ros: 11, flag: 24.6, clocked: 32.0, eff: 77 },
  period: { ros: 27, flag: 62.4, clocked: 76.5, eff: 82 },
  month: { ros: 41, flag: 98.6, clocked: 121.0, eff: 81 },
};

export const PACE = {
  goal: 110,
  current: 62.4,
  pct: 57, // current / goal
  dayOfPeriod: 8,
  periodDays: 14,
  daysLeft: 6,
  todayPct: 57, // where the "today" tick sits (day 8 / 14)
  projected: 104,
  state: "close" as const, // ahead | close | behind
  requiredPerDay: 7.9,
  earnings: 2184.0,
  periodLabel: "Jul 1 – Jul 15",
};

// 14 daily flag-hour bars for the history / averages charts.
export const DAILY_BARS = [
  { day: "24", v: 7.2 },
  { day: "25", v: 8.9 },
  { day: "26", v: 5.1 },
  { day: "27", v: 0 },
  { day: "28", v: 9.4 },
  { day: "29", v: 7.8 },
  { day: "30", v: 6.2 },
  { day: "1", v: 8.4 },
  { day: "2", v: 9.1 },
  { day: "3", v: 4.6 },
  { day: "4", v: 0 },
  { day: "5", v: 9.8 },
  { day: "6", v: 8.1 },
  { day: "7", v: 6.4 },
];

export const OP_LIBRARY: MockLine[] = [
  { code: "LOF", desc: "Lube, oil & filter", flag: 0.3 },
  { code: "BRKP2", desc: "Front pads + rotors", flag: 1.7 },
  { code: "DIAG", desc: "Check engine light diag", flag: 1.0 },
  { code: "ALIGN4", desc: "4-wheel alignment", flag: 1.2 },
  { code: "COOLFL", desc: "Coolant flush", flag: 1.2 },
  { code: "TIRE4", desc: "Rotate & balance", flag: 0.8 },
];

// Lines currently "on the form" in the log prototype.
export const FORM_LINES: MockLine[] = [
  { code: "BRKP2", desc: "Front pads + rotors", flag: 1.7 },
  { code: "LOF", desc: "Lube, oil & filter", flag: 0.3 },
];

export const QUICK_CHIPS = ["LOF", "TIRE4", "DIAG", "ALIGN4"];
