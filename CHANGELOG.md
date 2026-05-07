# Changelog

All notable changes to Flat Rate Tracker are documented here.

---

## [Unreleased] — 2026-05-07

### Dashboard — Averages Chart + Insight
- Replaced "coming soon" placeholder with a live interactive averages chart
- Tab selector: **Day · Week · Period · Month** — switches the chart view
- Pure SVG bar chart, no external library — best bar highlighted in orange, others neutral
- Footer line: "Avg X.Xh/day · best day: Tue"
- Insight bubble below the chart (brand-tinted card) with computed insights: best day of week, % change week-over-week / period-over-period / month-over-month
- Data fetch window extended from 1 month to 90 days for richer average calculations

### Account Page
- New `/account` route accessible from the header and nav
- **Profile** — First Name and Last Name fields; stored in Supabase user metadata, no migration required
- Dashboard greeting now uses first name when set: "Good afternoon, Liem"
- Avatar initial updates to use first name initial
- **Email** — change email with confirmation flow (Supabase sends a confirmation link)
- **Password** — change password with 8-character minimum and confirm-match validation; inline error/success feedback
- **Appearance** — Dark / Light mode toggle; preference saved to localStorage, applied before first paint to prevent flash of unstyled content

### History Page Redesign
- Filter chips redesigned: **Today · Week · Period · Month · All** (Custom date picker removed; defaults to Period)
- Bar chart added directly below filter chips:
  - Period: one bar per day from period start to end; past bars solid, future bars dashed outline, today's bar orange with `↑` marker
  - Week: 7 bars Mon–Sun
  - Month: one bar per calendar day
  - Today: hourly bars based on `createdAt` timestamp
  - All: one bar per month
  - Dense charts (>8 bars) show only start, end, and today labels to avoid overlap
- Search bar moved below the chart
- RO list redesigned as a flat list (no grouped date headers):
  - Row format: `#RO_NUM  Today · 2:14 PM  /  2019 Toyota Camry  /  2.4h`
  - Dashed dividers between rows
  - Rows sorted newest first
  - Clicking a row still opens the full RO detail modal

---

## [0.1.0] — 2026-04-29

### Hi-Fi Design System
- Full dark-mode design system with CSS custom properties (`--bg-*`, `--fg-*`, `--brand`, semantic colors)
- Sticky header + horizontal nav tabs with active indicator
- Card system: `.card.flush`, `.card.padded`, `.card.padded-lg`, `.card.brand-tinted`
- Stat tiles, pace bar, filter chips, pill badges
- Greeting card with avatar, pay period label, day-of-period counter, and pace pill

### Core Features
- Log RO: vehicle info (year/make/model/VIN/mileage), op codes (flag hours + actual hours + notes), RO-level notes
- Op code library: create, edit, reorder (full-row drag-and-drop), delete
- RO detail modal: edit all fields, add/delete individual op code lines
- History page: filter by today/week/period/month/all/custom, search by RO#/vehicle/notes
- Pay Period page: period stats, paid hours reconciliation, discrepancy tracking
- Timer: persistent server-side timer, saves to any open RO on stop
- Settings: pay period split day, period overrides, RO scan template management, data export
- Daily clocked hours input on dashboard
- Pay period pace bar with color-coded status pill (on pace / slightly behind / behind pace)
- OCR scan-to-log via Tesseract.js
- Guest mode (no login required, data lives in browser memory)
