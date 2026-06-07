# Landing Page — Claude Design Prompt

Reference prompt for generating the FRT marketing/landing page via Claude Design.
Update this file whenever new features are added or the visual direction changes.

---

Build a marketing landing page for **Flat Rate Tracker** — a web app built for automotive flat rate technicians to track their repair orders, earnings, and pay period pace. The target user is a working mechanic, probably on their phone, not super tech-savvy, and skeptical — they need to see the value fast before they'll bother making an account.

**Tech stack:** Next.js app router, Tailwind CSS, dark theme (zinc/near-black backgrounds, orange accent `#ea580c`). The landing page should live at the root `/` route and match the app's existing aesthetic — dark, clean, utility-first, no fluff.

---

**Goal of the page:** Let a brand-new visitor understand what the app does and why it's worth their time — without requiring them to sign up. Two CTAs: **"Create free account"** (primary) and **"Try it first — no account needed"** (secondary, routes to `/guest`).

---

**Features to showcase — use these as section content:**

**1. Pay Period Pace**
A visual progress bar showing how many flag hours you've banked vs. your goal (88 hrs), with a "today" tick mark showing where you should be. Color-coded pill: "On pace" / "Slightly behind" / "Behind pace." Tells you at a glance if you're going to make your check.

**2. Dashboard Stats**
Four stat tiles: Today, This Week, Pay Period, This Month. Each shows flag hours, clocked hours, and efficiency percentage. Real numbers, no estimates.

**3. RO Logging**
Log a repair order in seconds — RO number + op code. Optional: scan a barcode/QR code for the RO number. Supports saving and immediately starting the next RO ("Save & New"). Built-in op code library so you're not typing the same job descriptions every time.

**4. Op Code Library**
Build your own personal library of operation codes with descriptions. Supports parent/child relationships — a main op code can have sub-codes (e.g., "Brake Job" → "Front", "Rear", "Flush"). Expandable detail view in the log history.

**5. History + Charts**
Full RO log history with a bar chart of flag hours over time. Sortable. Each entry shows the op code, flag hours, and timestamp.

**6. Pay Period View**
Breaks down the current pay period with a discrepancy card — compares what the shop flagged vs. what you clocked. Helps catch missing hours before payday. Supports custom period overrides if your shop's pay cycle doesn't follow a standard pattern.

**7. Job Timer**
Built-in stopwatch for timing individual jobs. Has a floating Picture-in-Picture mode — keeps the timer visible as a small overlay while you navigate anywhere in the app. Save the time directly to an RO log entry when you're done.

**8. Quick Add RO**
A floating "+" button on the dashboard for logging an RO without navigating away. Just the RO number and op code — done in two taps.

**9. RO Templates**
Save job templates for common repairs so you can pre-fill an RO log in one tap instead of typing everything from scratch.

**10. Guest Mode**
Full app experience — log ROs, view history, check stats — without creating an account. Data is stored locally in the browser. Perfect for trying before committing.

**11. Settings**
Split day configuration (set when your work day resets — not always midnight), timezone picker, data import/export, and a Quick Add toggle.

---

**Visual direction:**
- Dark background, zinc palette (`zinc-900` / `zinc-950`)
- Orange accent `#ea580c` for CTAs, highlights, and the pace bar
- Clean, compact cards — no wasted whitespace
- Mobile-first — most users will view this on their phone in the parking lot
- No stock photo vibes — think tool UI, not SaaS marketing fluff
- Typography: tight, readable, functional — not decorative

**Section structure suggestion:**
1. Hero — headline, one-line value prop, both CTAs
2. "See your pace at a glance" — Pace bar feature callout
3. Feature grid — 3-column cards on desktop, stacked on mobile (pick the 6 most visual features)
4. "No account? No problem." — Guest mode section
5. Final CTA strip — Sign up / Try as guest
