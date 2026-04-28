# Flat Rate Tracker — Project Handoff

I'm building a web app called **Flat Rate Tracker** for automotive line technicians. We prototyped the full UI and data model as a Claude artifact, and now I want to turn it into a real, deployable app with authentication and multi-device sync. You'll be helping me build it out in this repo.

This document is the full context: product spec, data model, feature list, stack choices, and the prototype code to port from. Read it fully before writing anything.

---

## 1. Product Summary

**What it is:** A tool for automotive line technicians (flat-rate mechanics) to log the flagged hours they work on each repair order (RO), and reconcile those logs against what they actually got paid each pay period. The app's core value is catching pay discrepancies — if a tech flags 85 hours but the shop only pays them 80, those missing 5 hours are real money, and the logged ROs are proof.

**Who uses it:** Individual line technicians, one account per tech. Each tech's data is private to them.

**Primary workflows:**
1. Log ROs throughout the day (RO#, vehicle, op codes, flag hours per op code)
2. Optionally time jobs with a stopwatch that attaches to a specific op code on an RO
3. Enter today's clocked hours daily to track efficiency
4. At end of each pay period, enter actual paid flag hours and check for discrepancies
5. Review logged ROs as proof when disputing pay

---

## 2. Tech Stack

I want to build this with:

- **Next.js 14+** (App Router) — React framework, deploys to Vercel
- **TypeScript** — strict mode
- **Tailwind CSS** — already used in the prototype
- **Supabase** — Postgres database + authentication + Row Level Security (multi-device sync, free tier sufficient)
- **lucide-react** — icons (already used in prototype)

Deploy target: **Vercel**, connected to Supabase project.

Design: Dark mode only (matching the prototype). Mobile-first since techs will use this on phones in the shop. The prototype uses orange (`orange-500`/`orange-600`/`orange-400`) as the accent over a zinc neutral palette.

---

## 3. Core Concepts and Data Model

### 3.1 Entry (Repair Order)
The central record. One RO represents one vehicle visit, and contains one or more op code lines (jobs performed).

```ts
type Entry = {
  id: string;
  userId: string;
  createdAt: number;      // epoch ms
  updatedAt?: number;
  date: string;           // "YYYY-MM-DD" — the work date
  roNumber: string;       // unique per user, case-insensitive
  vehicle: {
    year: string;
    make: string;
    model: string;
  };
  opCodes: EntryOpCode[]; // at least one required
  flagHours: number;      // sum of opCodes[].flagHours, stored denormalized for fast queries
  notes: string;
};

type EntryOpCode = {
  opCodeId?: string;      // reference to library op code, if not custom
  custom: boolean;        // true = one-time, not from library
  customCode?: string | null;        // present when custom
  customDescription?: string | null; // present when custom
  flagHours: number;
  actualHours: number | null; // optional, time actually spent on this job
};
```

Important: `actualHours` lives on **each op code line**, not on the entry itself. A single RO can have multiple jobs, each with its own flag and actual.

### 3.2 OpCode (Library)
A tech's personal library of reusable op codes. Order matters — the library order is preserved and shown in that order in the Log RO picker.

```ts
type OpCode = {
  id: string;
  userId: string;
  code: string;         // e.g. "LOF", "BRK-F"
  description: string;  // e.g. "Lube, Oil, Filter"
  flagHours: number;    // default flag hours, can be overridden per RO
  sortOrder: number;    // for drag-and-drop ordering
};
```

Ship with this default seed list for new accounts:
- `LOF` — Lube, Oil, Filter — 0.3h
- `TR4` — Tire Rotation - 4 Wheel — 0.3h
- `BRK-F` — Front Brake Pads & Rotors — 1.5h
- `BRK-R` — Rear Brake Pads & Rotors — 1.3h
- `BATT` — Battery Replacement — 0.5h
- `ALIGN` — 4-Wheel Alignment — 1.0h

### 3.3 Pay Periods
Semi-monthly. Two per month:
- **P1:** 1st through `splitDay` (default 15)
- **P2:** `splitDay + 1` through end of month

Period keys are strings like `"2026-04-P1"` and `"2026-04-P2"`.

A user can:
1. Change the global `splitDay` in settings (affects all periods everywhere)
2. Override a specific period's dates explicitly (e.g. `"2026-04-P1"` gets forced to `2026-04-01`–`2026-04-14`). Overrides are stored by period key.

When determining which period a date belongs to, check overrides first. A date that falls within any override range uses that period's key. Otherwise fall back to the semi-monthly calculation with `splitDay`.

### 3.4 Daily Clocked Hours
For each day the tech worked, they enter how many hours they were clocked in. Used to calculate efficiency (flag hours ÷ clocked hours).

```ts
type DailyClock = {
  userId: string;
  date: string;   // "YYYY-MM-DD"
  hours: number;
};
```

### 3.5 Paid Hours Per Period
For each period, the tech enters their actual paid flag hours (from their paycheck). Used for the discrepancy check.

```ts
type PaidPeriod = {
  userId: string;
  periodKey: string;  // "YYYY-MM-P1" or "YYYY-MM-P2"
  paidFlagHours: number;
};
```

### 3.6 User Settings
```ts
type UserSettings = {
  userId: string;
  splitDay: number;  // 1..30, default 15
  periodOverrides: Record<string, { start: string; end: string }>;
  // Timer state is also stored here so it persists across devices:
  timerRoId: string | null;
  timerStartTime: number | null;   // null = paused
  timerAccumulated: number;        // ms accumulated while paused
};
```

The **timer is persistent** — if a user starts it on their phone, they should see it running on their laptop too. Store the state server-side.

### 3.7 Suggested Supabase Schema

All tables should have Row Level Security enabled with a policy like `user_id = auth.uid()`.

```sql
-- users table is managed by Supabase Auth

create table user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  split_day int not null default 15 check (split_day between 1 and 30),
  period_overrides jsonb not null default '{}'::jsonb,
  timer_ro_id uuid,
  timer_start_time bigint,
  timer_accumulated bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table op_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  code text not null,
  description text not null default '',
  flag_hours numeric(5,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index op_codes_user_sort_idx on op_codes(user_id, sort_order);

create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  ro_number text not null,
  vehicle_year text not null default '',
  vehicle_make text not null default '',
  vehicle_model text not null default '',
  flag_hours numeric(6,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Unique per user, case-insensitive
create unique index entries_user_ro_unique on entries(user_id, lower(ro_number));
create index entries_user_date_idx on entries(user_id, date desc);

create table entry_op_codes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries on delete cascade,
  op_code_id uuid references op_codes on delete set null, -- null for custom
  custom boolean not null default false,
  custom_code text,
  custom_description text,
  flag_hours numeric(5,2) not null default 0,
  actual_hours numeric(5,2),
  position int not null default 0
);
create index entry_op_codes_entry_idx on entry_op_codes(entry_id);

create table daily_clock_hours (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,
  hours numeric(4,2) not null default 0,
  primary key (user_id, date)
);

create table paid_period_hours (
  user_id uuid not null references auth.users on delete cascade,
  period_key text not null,
  paid_flag_hours numeric(6,2) not null default 0,
  primary key (user_id, period_key)
);
```

RLS policies (apply similar to every table):
```sql
alter table entries enable row level security;
create policy "own_entries" on entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

A trigger should auto-create a `user_settings` row and seed default op codes when a new user signs up.

---

## 4. Feature List (Screen by Screen)

The prototype has exactly these screens as top-nav tabs. Keep the same structure.

### 4.1 Dashboard
- Header shows current pay period label ("Apr 16 – Apr 30")
- Card at top for entering **Today's Clocked Hours** — number input, shows today's efficiency % calculated live
- Grid of 4 stat cards: Today, This Week, Pay Period (highlighted), This Month — each showing flag hours, clocked hours, efficiency %
- Recent ROs list (most recent 5), each clickable to open detail modal

Efficiency = `flagHours / clockedHours × 100`. "This Week" starts on Sunday.

### 4.2 Log RO (creates new entries, also used for editing)
Fields:
- Date (defaults to today)
- RO Number (required, must be unique per user, case-insensitive)
- Vehicle: Year / Make / Model (3-column, all optional but usually filled)
- Op Codes picker — **typeahead search dropdown**. Typing filters the library by code or description. Below the library list, two "Other" options:
  - "Custom op code (one-time)" — opens modal for code, description, flag hours; adds to this RO only, does NOT save to library
  - "Create new library op code" — opens modal for code, description, default flag hours; saves to library AND adds to this RO
  - Both modals should inherit the current search query as the initial code value
- For each added op code line: label, FLAG HRS input, ACTUAL HRS input (optional), remove button
- Notes (optional textarea)
- Total flag hours shown at the bottom of the op codes section
- Save button. On save, check for RO# conflict (excluding the entry being edited, if any). Show red error if conflict.

When in edit mode, the title changes to "Edit RO #X", a Cancel link appears, and the Save button says "Save Changes".

### 4.3 History
- Filter chips: Today, This Week, Pay Period, This Month, All, Custom (with date range inputs when selected)
- Search bar: matches RO#, vehicle, or notes (case-insensitive substring)
- Summary bar: RO count, total flag hours, total actual hours
- List of entries, each clickable to open detail modal
- Each row shows RO#, date, vehicle, op code pills (code + flag/actual), and the RO's total flag hours

### 4.4 Timer
- Big digital timer (HH:MM:SS) with state: READY / RUNNING / PAUSED
- Start / Pause / Reset controls. State persists server-side so it survives navigation and device changes.
- "Attached RO" section — shows currently picked RO with a clear button
- "Save to Job" button — disabled when no RO is picked or elapsed is zero. Opens a modal listing all op codes on the attached RO; user picks which one to attach the time to. Saving **replaces** that op code's `actualHours` (confirm if one already exists). After save, the timer resets.
- Recent ROs list below for picking an RO to attach
- Nav shows a green pulsing dot on the Timer tab when the timer is running

### 4.5 Pay Period
- Period selector dropdown — lists all periods that have entries, paid hours, or overrides, with the current period marked
- "Set custom dates" / "Edit custom dates" / "Reset to default" controls below the selector
- 4 mini stats: RO count, Flag Hrs (highlighted), Clocked Hrs, Efficiency
- Pay Discrepancy Check card:
  - 3 fields: Actual Paid Flag Hrs (input), Logged Flag Hrs (readonly), Difference (computed, color-coded: red = missing, yellow = over, green = match, grey = not entered yet)
  - Tolerance of ±0.1 hours for "match"
  - Red alert below if missing: "Missing X hours. Review the RO list below — use the logged ROs as proof..."
- ROs in this period list (compact rows, clickable to detail modal)

### 4.6 Op Codes
- Add button (top right)
- Search bar (filters library by code or description)
- Draggable list — each row has a grip handle (hidden when searching), code, description, flag hours, edit, delete
- Drag-and-drop reorders the library. **Use `@dnd-kit/core` + `@dnd-kit/sortable`** — it has proper touch support for mobile, unlike the prototype which uses native HTML5 drag.
- Add/edit modal: code, description, default flag hours

### 4.7 Settings
- **Pay Period Defaults** section: number input for "First period ends on day" (1–30). Shows a preview of the resulting ranges. If any overrides exist, shows a note with the count and directs the user to the Pay Period tab to manage them.
- **Data** section: Export JSON, Import JSON. Export is the user's complete data dump. Import replaces all data (with confirmation).
- **Danger Zone**: Clear all data (double confirm).

### 4.8 RO Detail Modal
Opens from any RO# click anywhere in the app. Shows:
- RO#, date, logged timestamp
- Vehicle
- Each op code line with code, description, flag (readonly), **editable actual hours input** (changes save immediately on blur / change)
- Totals: flag and actual
- Notes (if any)
- Three buttons: Edit RO (opens Log form pre-filled), Delete (with confirm), Close

---

## 5. Design Notes

- Dark mode only. Background zinc-950, cards zinc-900, borders zinc-800.
- Accent color orange. Gradient for emphasized cards: `from-orange-950/60 to-red-950/40` with `border-orange-900/60`.
- Header has a Wrench icon in an orange-to-red gradient square. The whole header is a button that navigates to Dashboard.
- Top nav is horizontally scrollable on mobile, sticky, with an orange underline for the active tab.
- Modals: backdrop `bg-black/70`, panel zinc-900 with zinc-800 border, rounded-xl, `max-h-[90vh] overflow-y-auto`. Bottom-sheet behavior on mobile (`items-end`), centered on desktop (`sm:items-center`).
- Use `lucide-react` for all icons.
- Show/hide confirmations for destructive actions (delete RO, delete op code, reset timer with time on it, clear all data).

---

## 6. Prototype Code Reference

The full working React prototype is in the Claude conversation that produced this handoff. If you want a direct port, I can paste the prototype source here on request. It's ~1100 lines of a single React component using `window.storage` for persistence. All logic (period calculations, stat aggregation, filtering, timer state, etc.) is proven to work and can be ported directly — the main changes are:

1. Replace `window.storage` calls with Supabase client calls
2. Split the single component file into proper Next.js routes and components
3. Add authentication (sign up, sign in, sign out pages; protected routes)
4. Swap the native HTML5 drag-and-drop in the Op Code Library for `@dnd-kit`
5. Add proper TypeScript types matching the data model in section 3
6. Wrap mutations in optimistic updates where appropriate (especially timer start/stop and actual hours edits)

---

## 7. How I'd Like to Work

Start by setting up the project scaffolding:

1. Initialize the Next.js + TypeScript + Tailwind project
2. Set up Supabase: create the schema, RLS policies, and the new-user trigger
3. Wire up Supabase auth with email + password (magic link optional)
4. Build a `lib/types.ts` with the data model types
5. Build a data layer in `lib/db/` — one file per resource (entries, op codes, settings, etc.) that wraps Supabase queries

Then build the screens in this order (each one end-to-end before moving on):

1. Auth (sign up / sign in / sign out)
2. Dashboard shell + Log RO (the core logging loop)
3. History
4. Op Codes library (with @dnd-kit)
5. Timer
6. Pay Period
7. Settings + data import/export
8. Deploy to Vercel

For each feature, walk me through what you're doing at a high level before making sweeping changes, and ask me to confirm before you spend effort on anything non-obvious.

Ready when you are — let's start with the project scaffolding and Supabase setup.
