"use client";

import Link from "next/link";
import { useEffect } from "react";

/* ── Scroll reveal ────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    if (!window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches) return;
    const wrap = document.getElementById("lp");
    if (!wrap) return;
    wrap.classList.add("lp-animate");

    const check = () => {
      const vh = window.innerHeight;
      wrap.querySelectorAll<HTMLElement>("[data-rv]").forEach((el) => {
        if (!el.classList.contains("rv-in")) {
          const r = el.getBoundingClientRect();
          if (r.top < vh * 0.92 && r.bottom > 0) el.classList.add("rv-in");
        }
      });
    };

    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; check(); });
    };
    requestAnimationFrame(check);
    setTimeout(check, 150);
    setTimeout(check, 450);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
}

type RvProps = {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
  as?: React.ElementType;
  [key: string]: unknown;
};

function Rv({ children, delay = 0, className = "", style, as: Tag = "div", ...rest }: RvProps) {
  return (
    <Tag
      data-rv
      className={className}
      style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ── Shared primitives ───────────────────────────────── */

function Wordmark({ size = 17 }: { size?: number }) {
  const height = size <= 15 ? 36 : 60;
  return (
    <img
      src="/frt-logo.png"
      alt="Flat Rate Tracker"
      style={{ height, width: "auto", display: "block" }}
    />
  );
}

function Pill({ state }: { state: "green" | "amber" | "red" }) {
  const map = {
    green: { cls: "bg-[var(--good-bg)] text-[var(--good)]", label: "On pace" },
    amber: { cls: "bg-[var(--warn-bg)] text-[var(--warn)]", label: "Slightly behind" },
    red: { cls: "bg-[var(--bad-bg)] text-[var(--bad)]", label: "Behind pace" },
  };
  const m = map[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-bold tracking-[0.04em] whitespace-nowrap ${m.cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

function PaceBar({
  now,
  goal,
  pct,
  todayPct,
  state,
  compact = false,
}: {
  now: string;
  goal: string;
  pct: number;
  todayPct: number;
  state: "green" | "amber" | "red";
  compact?: boolean;
}) {
  return (
    <div className="card p-[18px]">
      <div className="flex items-center justify-between mb-3.5">
        <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--fg-3)]">
          Pay Period Pace{compact ? "" : " · 9 days left"}
        </span>
        <Pill state={state} />
      </div>
      <div className="flex items-baseline justify-between mb-3">
        <span
          className="font-mono font-bold text-[var(--fg-0)] whitespace-nowrap"
          style={{ fontSize: compact ? 18 : 22 }}
        >
          {now}
          <span className="text-[var(--fg-3)] ml-0.5" style={{ fontSize: compact ? 12 : 14 }}>
            {" "}flag hrs
          </span>
        </span>
        <span className="font-mono text-[var(--fg-3)] text-sm whitespace-nowrap">Goal {goal}</span>
      </div>
      <div
        className="relative bg-[var(--bg-3)] rounded-full"
        style={{ height: compact ? 12 : 14 }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--brand-strong), var(--brand))",
          }}
        />
        <div
          className="absolute -top-[5px] -bottom-[5px] w-0.5 bg-[var(--fg-1)]"
          style={{ left: `${todayPct}%` }}
        >
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[8px] tracking-[0.1em] text-[var(--fg-2)] whitespace-nowrap">
            TODAY
          </span>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  lab,
  big,
  unit,
  sub,
  mini = false,
}: {
  lab: string;
  big: string;
  unit: string;
  sub?: React.ReactNode;
  mini?: boolean;
}) {
  return (
    <div className="card rounded-[var(--radius)] p-3.5">
      <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--fg-3)] mb-2">{lab}</div>
      <div className="font-mono font-bold text-[var(--fg-0)] leading-none" style={{ fontSize: mini ? 22 : 26 }}>
        {big}
        <span className="text-[13px] text-[var(--fg-3)] ml-0.5">{unit}</span>
      </div>
      {sub && <div className="font-mono text-[11px] text-[var(--fg-2)] mt-1.5">{sub}</div>}
    </div>
  );
}

function BarChart({ bars, height }: { bars: number[]; height: number }) {
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-[2px] ${h > 78 ? "bg-[var(--brand-strong)]" : "bg-[var(--bg-4)]"}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function ROForm() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--fg-3)] mb-1.5">
          RO Number
        </label>
        <div className="bg-[var(--bg-1)] border border-[var(--line)] rounded-[var(--radius-sm)] px-3 py-2.5 flex items-center">
          <span className="font-mono font-semibold text-[var(--fg-0)] text-base">48213</span>
        </div>
      </div>
      <div>
        <label className="block font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--fg-3)] mb-1.5">
          Op Code
        </label>
        <div className="bg-[var(--bg-1)] border border-[var(--line)] rounded-[var(--radius-sm)] px-3 py-2.5 flex items-center gap-2.5">
          <span className="font-mono font-semibold text-[var(--fg-0)] text-base">BRK-FR</span>
          <span className="font-mono text-[11px] text-[var(--fg-3)]">Front brake job · 2.4 hrs</span>
        </div>
      </div>
      <div className="flex gap-2 mt-0.5">
        <button className="btn btn-primary text-[13px] px-3.5 py-2 whitespace-nowrap cursor-default">
          Save &amp; New
        </button>
        <button className="btn text-[13px] px-3.5 py-2 whitespace-nowrap cursor-default">
          Save
        </button>
      </div>
    </div>
  );
}

function OpCodeList() {
  return (
    <div className="flex flex-col gap-px bg-[var(--line)] border border-[var(--line)] rounded-[var(--radius)] overflow-hidden">
      {/* BRK — expanded */}
      <div
        className="grid items-center gap-2.5 px-3 py-2.5 bg-[var(--bg-2)]"
        style={{ gridTemplateColumns: "16px 64px 1fr auto" }}
      >
        <span className="text-[10px] text-[var(--fg-3)]">▾</span>
        <span className="font-mono font-semibold text-[12px] text-[var(--fg-0)]">BRK</span>
        <span className="text-[13px] font-semibold text-[var(--fg-1)]">Brake Job</span>
        <span className="font-mono text-[12px] text-[var(--fg-2)]">—</span>
      </div>
      {[
        { code: "BRK-FR", desc: "Front", hrs: "2.4" },
        { code: "BRK-RR", desc: "Rear", hrs: "2.1" },
        { code: "BRK-FL", desc: "Flush", hrs: "0.6" },
      ].map((row) => (
        <div
          key={row.code}
          className="grid items-center gap-2.5 py-2.5 bg-[var(--bg-1)]"
          style={{ gridTemplateColumns: "64px 1fr auto", paddingLeft: 36, paddingRight: 13 }}
        >
          <span className="font-mono font-semibold text-[12px] text-[var(--brand)]">{row.code}</span>
          <span className="text-[13px] text-[var(--fg-1)]">{row.desc}</span>
          <span className="font-mono text-[12px] text-[var(--fg-2)]">{row.hrs}</span>
        </div>
      ))}
      {/* SUSP — collapsed */}
      <div
        className="grid items-center gap-2.5 px-3 py-2.5 bg-[var(--bg-2)] opacity-90"
        style={{ gridTemplateColumns: "16px 64px 1fr auto" }}
      >
        <span className="text-[10px] text-[var(--fg-3)]">▸</span>
        <span className="font-mono font-semibold text-[12px] text-[var(--fg-0)]">SUSP</span>
        <span className="text-[13px] font-semibold text-[var(--fg-1)]">Suspension</span>
        <span className="font-mono text-[12px] text-[var(--fg-2)]">3 sub-codes</span>
      </div>
    </div>
  );
}

function DiscrepancyCard() {
  return (
    <div className="flex flex-col gap-2.5">
      {[
        { label: "Shop flagged", value: "64.2", unit: "hrs" },
        { label: "You clocked", value: "66.5", unit: "hrs" },
      ].map((row) => (
        <div key={row.label} className="flex items-baseline justify-between">
          <span className="font-mono text-[12px] tracking-[0.05em] text-[var(--fg-2)]">{row.label}</span>
          <span className="font-mono font-bold text-lg text-[var(--fg-0)]">
            {row.value}{" "}
            <span className="text-[11px] text-[var(--fg-3)] font-normal">{row.unit}</span>
          </span>
        </div>
      ))}
      <div className="h-px bg-[var(--line)] my-0.5" />
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[12px] tracking-[0.05em] text-[var(--fg-1)]">Discrepancy</span>
        <span className="font-mono font-bold text-lg text-[var(--warn)]">
          −2.3{" "}
          <span className="text-[11px] text-[var(--fg-3)] font-normal">hrs</span>
        </span>
      </div>
      <p className="font-mono text-[11px] text-[var(--fg-3)] leading-relaxed pt-0.5">
        3 ROs may be missing hours — check before payday.
      </p>
    </div>
  );
}

function HistoryRows() {
  const rows = [
    { code: "BRK-FR", hrs: "2.4", t: "Today 2:14p" },
    { code: "DIAG", hrs: "1.0", t: "Today 11:02a" },
    { code: "ALN-4", hrs: "1.8", t: "Today 9:40a" },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid items-center gap-2.5 px-3 py-2 bg-[var(--bg-1)] border border-[var(--line)] rounded-[var(--radius-sm)]"
          style={{ gridTemplateColumns: "70px 1fr auto" }}
        >
          <span className="font-mono font-semibold text-[12px] text-[var(--brand)]">{r.code}</span>
          <span className="font-mono text-[12px] text-[var(--fg-0)]">{r.hrs} hrs</span>
          <span className="font-mono text-[11px] text-[var(--fg-3)]">{r.t}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Sections ────────────────────────────────────────── */

function Nav() {
  return (
    <nav
      className="sticky top-0 z-50 border-b border-[var(--line)]"
      style={{
        background: "color-mix(in srgb, var(--bg-0) 82%, transparent)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="max-w-[1180px] mx-auto px-7 flex items-center justify-between h-[76px] max-sm:h-[68px] max-sm:px-[18px]">
        <Link href="/" className="no-underline">
          <Wordmark />
        </Link>
        <div className="flex gap-2.5 items-center">
          <Link href="/guest" className="hidden sm:inline-flex btn btn-ghost">
            Try as guest
          </Link>
          <Link
            href="/signin"
            className="hidden sm:inline-flex items-center font-bold text-sm px-4 py-2 rounded-full text-[var(--fg-2)] hover:text-[var(--fg-0)] transition-colors whitespace-nowrap"
          >
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Create free account
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const bars = [42, 55, 38, 67, 49, 72, 58, 80, 61, 44, 69, 88, 52, 75];
  return (
    <header className="pt-[72px] pb-[88px] max-[900px]:pt-12 max-[900px]:pb-16 max-sm:pt-9 max-sm:pb-[52px]">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px] flex flex-col gap-0">
        <Rv>
          <div className="inline-flex items-center gap-2.5">
            <span className="block w-5 h-0.5 bg-[var(--brand-strong)]" />
            <span className="font-mono text-[13px] font-semibold tracking-[0.18em] uppercase text-[var(--brand-strong)] max-sm:text-[12px] max-sm:tracking-[0.12em]">
              Built for the tech, not the shop
            </span>
          </div>
        </Rv>

        <Rv delay={60}>
          <h1
            className="font-extrabold leading-none tracking-tight text-[var(--fg-0)] text-balance mt-5 mb-0 max-sm:mt-4"
            style={{ fontSize: "clamp(33px, 5vw, 56px)", maxWidth: 840 }}
          >
            Every RO you log makes you harder to short.
          </h1>
        </Rv>

        <Rv delay={120}>
          <p
            className="text-[var(--fg-2)] leading-[1.55] mt-5 mb-0 max-sm:mt-4"
            style={{ fontSize: "clamp(16px, 2vw, 18px)", maxWidth: 520 }}
          >
            FRT turns your daily work into a record that compounds — proof you got paid right,
            numbers that show your worth, and leverage that grows every single job. Start today;
            thank yourself in a year.
          </p>
        </Rv>

        <Rv delay={180}>
          <div className="flex gap-3 flex-wrap mt-7 max-sm:mt-6 max-sm:flex-col max-sm:items-stretch">
            <Link href="/signup" className="btn btn-primary btn-lg max-sm:justify-center">
              Create free account
            </Link>
            <Link href="/guest" className="btn btn-lg max-sm:justify-center">
              Try it first{" "}
              <span className="font-mono text-[var(--brand)]">— no account →</span>
            </Link>
          </div>
          <p className="font-mono text-[12px] text-[var(--fg-3)] mt-5 max-sm:mt-[18px]">
            Free to start · Works on your phone in the bay
          </p>
        </Rv>

        {/* Dashboard mock */}
        <Rv delay={120} className="flex flex-col gap-3 mt-8 max-sm:mt-6">
          <div className="grid grid-cols-4 gap-2.5 max-sm:grid-cols-2">
            <StatTile lab="Today" big="6.4" unit="hrs" sub={<span className="text-[var(--good)]">112% eff</span>} />
            <StatTile lab="This Week" big="38.1" unit="hrs" sub={<span className="text-[var(--good)]">104% eff</span>} />
            <StatTile lab="Pay Period" big="64.2" unit="hrs" sub={<span className="text-[var(--good)]">98% eff</span>} />
            <StatTile lab="This Month" big="142" unit="hrs" sub={<span className="text-[var(--good)]">101% eff</span>} />
          </div>
          <div
            className="grid gap-3 max-sm:grid-cols-1"
            style={{ gridTemplateColumns: "1.25fr 1fr" }}
          >
            <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" />
            <div className="card p-[18px] flex flex-col">
              <div className="flex items-center justify-between mb-3.5">
                <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--fg-3)]">
                  Flag hrs · 14 days
                </span>
              </div>
              <BarChart bars={bars} height={84} />
            </div>
          </div>
        </Rv>
      </div>
    </header>
  );
}

function PaceSection() {
  return (
    <section className="py-24 max-[900px]:py-[72px] max-sm:py-14">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <div className="max-w-[620px]">
          <Rv>
            <span className="font-mono text-[12px] tracking-[0.14em] uppercase text-[var(--fg-3)]">
              Pay Period Pace
            </span>
          </Rv>
          <Rv delay={60}>
            <h2
              className="font-extrabold tracking-tight text-[var(--fg-0)] text-balance mt-4 mb-0"
              style={{ fontSize: "clamp(28px, 3.5vw, 40px)" }}
            >
              See your pace at a glance.
            </h2>
          </Rv>
          <Rv delay={120}>
            <p
              className="text-[var(--fg-2)] leading-[1.55] mt-4 mb-0"
              style={{ fontSize: "clamp(16px, 1.8vw, 17px)" }}
            >
              One bar shows everything: how many flag hours you&apos;ve banked, your goal, and a{" "}
              <strong className="text-[var(--fg-1)]">today</strong>{" "}tick for exactly where you should be.
              Green means you&apos;re good. Color shifts the second you start slipping.
            </p>
          </Rv>
        </div>

        <Rv delay={100} className="mt-10 flex flex-col gap-3.5 max-w-[720px]">
          <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" />
          <div className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
            <PaceBar now="48.0" goal="88" pct={55} todayPct={62} state="amber" compact />
            <PaceBar now="33.5" goal="88" pct={38} todayPct={62} state="red" compact />
          </div>
        </Rv>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      t: "Keep your own books.",
      d: "Most shops know techs don't track their own hours — and some count on it. When flagged time doesn't show up on your check, there's no record to push back with. FRT is that record.",
    },
    {
      n: "02",
      t: "Know before payday.",
      d: "A live pace bar tracks where you stand against your pay period goal every time you log an RO. If you're slipping, you'll see it with time to fix it — not after the check is already cut.",
    },
    {
      n: "03",
      t: "Build a record only you control.",
      d: "Every RO you log builds a real picture of how you perform — efficiency rates, average flag hours, the jobs you run most. Yours to keep, no matter which shop you're standing in.",
    },
  ];
  return (
    <section className="pb-24 max-[900px]:pb-[72px] max-sm:pb-14">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <Rv>
          <span className="font-mono text-[12px] tracking-[0.14em] uppercase text-[var(--fg-3)]">
            Built for flat rate
          </span>
        </Rv>
        <Rv delay={60}>
          <h2
            className="font-extrabold tracking-tight text-[var(--fg-0)] mt-3.5 mb-0"
            style={{ fontSize: 36 }}
          >
            You flag the hours. Make sure you get paid for every one.
          </h2>
        </Rv>
        <div className="grid grid-cols-3 gap-5 mt-11 max-[900px]:grid-cols-1 max-[900px]:gap-7">
          {steps.map((s, i) => (
            <Rv key={s.n} delay={i * 90} className="pt-6 border-t-2 border-[var(--line)]">
              <div className="font-mono font-bold text-[13px] text-[var(--brand-strong)] tracking-[0.1em]">
                {s.n}
              </div>
              <h3 className="text-xl font-bold mt-3 mb-2 text-[var(--fg-0)] tracking-tight">{s.t}</h3>
              <p className="text-[var(--fg-2)] leading-[1.55] m-0 text-base">{s.d}</p>
            </Rv>
          ))}
        </div>
      </div>
    </section>
  );
}

function LongGame() {
  return (
    <section className="pb-24 max-[900px]:pb-[72px] max-sm:pb-14">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <div className="max-w-[680px]">
          <Rv>
            <span className="font-mono text-[12px] tracking-[0.14em] uppercase text-[var(--fg-3)]">
              The long game
            </span>
          </Rv>
          <Rv delay={60}>
            <h2
              className="font-extrabold tracking-tight text-[var(--fg-0)] text-balance mt-4 mb-0"
              style={{ fontSize: "clamp(28px, 3.5vw, 40px)" }}
            >
              Day one, it tracks a job. Year one, it tracks your career.
            </h2>
          </Rv>
          <Rv delay={120}>
            <p
              className="text-[var(--fg-2)] leading-[1.6] mt-5 mb-0"
              style={{ fontSize: "clamp(16px, 1.8vw, 17px)" }}
            >
              Every RO you log is one more data point in the only record that&apos;s actually
              yours. <strong className="text-[var(--fg-1)]">Day one</strong>, it catches a shorted
              check. <strong className="text-[var(--fg-1)]">Month six</strong>, it shows your real
              efficiency across every job type. <strong className="text-[var(--fg-1)]">Year one</strong>,
              it&apos;s the case you put on the service manager&apos;s desk when it&apos;s time to
              talk money — or the proof you take to a better shop. Most techs throw that record
              away every payday. You don&apos;t have to.
            </p>
          </Rv>
        </div>
      </div>
    </section>
  );
}

const featCards = [
  {
    tag: "Dashboard",
    title: "Real numbers, four ways",
    desc: "Today, this week, pay period, this month — flag hours, clocked hours, and efficiency. No estimates.",
    visual: (
      <div className="grid grid-cols-2 gap-2">
        <StatTile lab="Today" big="6.4" unit="h" sub={<span className="text-[var(--good)]">112%</span>} mini />
        <StatTile lab="Week" big="38.1" unit="h" sub={<span className="text-[var(--good)]">104%</span>} mini />
        <StatTile lab="Pay Period" big="64.2" unit="h" sub={<span className="text-[var(--good)]">98%</span>} mini />
        <StatTile lab="Month" big="142" unit="h" sub={<span className="text-[var(--good)]">101%</span>} mini />
      </div>
    ),
  },
  {
    tag: "Pay Period Pace",
    title: "Know if you'll make it",
    desc: "A live bar against your goal with a today tick, and an at-a-glance pill: on pace, slightly behind, behind.",
    visual: <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" compact />,
  },
  {
    tag: "RO Logging",
    title: "Logged in two taps",
    desc: "RO number plus op code. Snap a photo of the repair order and the fields fill themselves — or type it by hand. Hit Save & New and start the next job.",
    visual: <ROForm />,
  },
  {
    tag: "Op Code Library",
    title: "Your codes, your way",
    desc: 'Build a personal library with parent / child codes — "Brake Job" → Front, Rear, Flush. Stop retyping.',
    visual: <OpCodeList />,
  },
  {
    tag: "Pay Period View",
    title: "Catch missing hours",
    desc: "Compares what the shop flagged against what you clocked, so you spot the gap before payday.",
    visual: <DiscrepancyCard />,
  },
  {
    tag: "History + Charts",
    title: "Every RO, charted",
    desc: "Full sortable log with flag hours over time. Each entry shows op code, hours, and timestamp.",
    visual: (
      <div className="flex flex-col gap-2.5">
        <BarChart bars={[40, 58, 46, 70, 55, 78, 62]} height={48} />
        <HistoryRows />
      </div>
    ),
  },
];

function Features() {
  return (
    <section id="features" className="pb-24 max-[900px]:pb-[72px] max-sm:pb-14">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <div className="max-w-[620px]">
          <Rv>
            <span className="font-mono text-[12px] tracking-[0.14em] uppercase text-[var(--fg-3)]">
              Everything you track
            </span>
          </Rv>
          <Rv delay={60}>
            <h2
              className="font-extrabold tracking-tight text-[var(--fg-0)] text-balance mt-4 mb-0"
              style={{ fontSize: "clamp(28px, 3.5vw, 40px)" }}
            >
              Made for the bay, not the boardroom.
            </h2>
          </Rv>
        </div>

        <div className="grid grid-cols-3 gap-[18px] mt-12 max-[900px]:grid-cols-2 max-sm:grid-cols-1 max-sm:mt-8">
          {featCards.map((f, i) => (
            <Rv
              key={f.tag}
              delay={(i % 3) * 80}
              className="card rounded-[var(--radius)] p-[22px] flex flex-col hover:border-[var(--brand-soft)] hover:-translate-y-0.5 transition-all duration-200"
            >
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--brand-strong)]">
                {f.tag}
              </span>
              <h3 className="text-lg font-bold mt-2 mb-1.5 text-[var(--fg-0)] tracking-tight">
                {f.title}
              </h3>
              <p className="text-[var(--fg-2)] text-sm leading-[1.5] mb-[18px]">{f.desc}</p>
              <div className="mt-auto">{f.visual}</div>
            </Rv>
          ))}
        </div>
      </div>
    </section>
  );
}

function GuestMode() {
  return (
    <section className="py-[88px] bg-[var(--bg-1)] border-t border-b border-[var(--line)] max-sm:py-14">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <div
          className="grid gap-12 max-[900px]:grid-cols-1 max-[900px]:gap-8"
          style={{ gridTemplateColumns: "1.1fr 0.9fr" }}
        >
          <div>
            <Rv>
              <span className="font-mono text-[12px] tracking-[0.14em] uppercase text-[var(--brand-strong)]">
                Guest mode
              </span>
            </Rv>
            <Rv delay={60}>
              <h2
                className="font-extrabold tracking-tight text-[var(--fg-0)] mt-3.5 mb-0"
                style={{ fontSize: "clamp(28px, 3.5vw, 40px)" }}
              >
                No account? No problem.
              </h2>
            </Rv>
            <Rv delay={120}>
              <p
                className="text-[var(--fg-2)] leading-[1.55] mt-4 mb-7 max-sm:mb-6"
                style={{ fontSize: "clamp(16px, 1.8vw, 17px)", maxWidth: 440 }}
              >
                Log ROs, check your stats, watch your pace — the whole app, no signup. Your data
                stays in your browser. Make an account when you&apos;re ready to keep it.
              </p>
            </Rv>
            <Rv delay={180}>
              <Link href="/guest" className="btn btn-primary btn-lg max-sm:w-full max-sm:justify-center">
                Try it first — no account needed
              </Link>
            </Rv>
          </div>

          <Rv delay={120} className="card rounded-[var(--radius)] p-6">
            <div className="flex items-center gap-2.5 mb-[18px] flex-wrap">
              <span className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[var(--brand)] bg-[var(--brand-bg)] px-2.5 py-1.5 rounded-full whitespace-nowrap">
                ● Guest session
              </span>
              <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--fg-3)] ml-auto">
                saved locally
              </span>
            </div>
            <ul className="flex flex-col gap-3 m-0 p-0 list-none">
              {[
                "Log unlimited repair orders",
                "Full dashboard & pace tracking",
                "Op code library & history",
                "Job timer with PiP mode",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-[var(--fg-1)]">
                  <span className="w-[18px] h-[18px] rounded-full bg-[var(--good-bg)] text-[var(--good)] grid place-items-center text-[11px] flex-shrink-0 mt-px">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="font-mono text-[11px] text-[var(--fg-3)] mt-[18px] leading-relaxed">
              Nothing leaves your phone until you create an account — then it all syncs over.
            </p>
          </Rv>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-24 max-sm:py-16 border-t border-[var(--line)]">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px]">
        <div className="max-w-[620px]">
          <Rv>
            <div className="inline-flex items-center gap-2.5">
              <span className="block w-5 h-0.5 bg-[var(--brand-strong)]" />
              <span className="font-mono text-[12px] font-semibold tracking-[0.18em] uppercase text-[var(--brand-strong)]">
                Flat Rate Tracker
              </span>
            </div>
          </Rv>
          <Rv delay={60}>
            <h2
              className="font-extrabold tracking-tight text-[var(--fg-0)] text-balance mt-4 mb-0"
              style={{ fontSize: "clamp(28px, 4vw, 44px)" }}
            >
              Nobody&apos;s looking out for the tech. So we built the tool that does.
            </h2>
          </Rv>
          <Rv delay={120}>
            <p
              className="text-[var(--fg-2)] leading-[1.55] mt-4 mb-0"
              style={{ fontSize: "clamp(16px, 1.8vw, 18px)", maxWidth: 480 }}
            >
              Set up in under a minute. See exactly where your pay period stands by your next RO.
            </p>
          </Rv>
          <Rv delay={180}>
            <div className="flex items-center gap-5 flex-wrap mt-7 max-sm:mt-6">
              <Link href="/signup" className="btn btn-primary btn-lg max-sm:justify-center">
                Create free account
              </Link>
              <Link
                href="/guest"
                className="font-mono text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors no-underline"
              >
                Try it first — no account →
              </Link>
            </div>
          </Rv>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--line)] py-10">
      <div className="max-w-[1180px] mx-auto px-7 max-sm:px-[18px] flex items-center justify-between flex-wrap gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-[18px]">
        <Link href="/" className="no-underline">
          <Wordmark size={15} />
        </Link>
        <div className="flex gap-5">
          {[
            { label: "Features", href: "#features" },
            { label: "Guest mode", href: "/guest" },
            { label: "Sign in", href: "/signin" },
          ].map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="font-mono text-sm text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors whitespace-nowrap no-underline"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <span className="font-mono text-[12px] text-[var(--fg-3)]">© 2026 Flat Rate Tracker</span>
      </div>
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────── */
export default function LandingPage() {
  useReveal();
  return (
    <>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          #lp.lp-animate [data-rv] {
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.65s cubic-bezier(0.22, 0.61, 0.36, 1),
                        transform 0.65s cubic-bezier(0.22, 0.61, 0.36, 1);
          }
          #lp.lp-animate [data-rv].rv-in {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
      <div id="lp" className="min-h-screen selection:bg-[var(--brand)] selection:text-[var(--brand-ink)]">
        <Nav />
        <Hero />
        <PaceSection />
        <HowItWorks />
        <LongGame />
        <Features />
        <GuestMode />
        <FinalCTA />
        <Footer />
      </div>
    </>
  );
}
