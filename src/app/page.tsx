"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, Head, HeadCell, HeadCells } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";
import { HoursChart, type ChartBar } from "@/components/dashboard/AveragesChart";
import { LogoMark, LogoWord } from "@/components/layout/icons";

/* The landing's demo visuals are the app's real parts fed static props: Head
   for the figure tiles, the dashboard's pace track, Field + .input for the RO
   form, .rows + badge-chip for the op-code list, StatusField for the
   discrepancy, HoursChart for the bars, .tag for history. Styles: page-landing.css. */

/* ── Scroll reveal ────────────────────────────────────── */
// Only runs when the visitor has not asked for reduced motion; otherwise
// nothing is hidden and nothing moves (the CSS is gated the same way).
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

/* ── Demo visuals (static props, real shared parts) ──── */

type PaceState = "green" | "amber" | "red";

const PACE_BADGE: Record<PaceState, { tone: "good" | "warn" | "bad"; label: string }> = {
  green: { tone: "good", label: "On pace" },
  amber: { tone: "warn", label: "Slightly behind" },
  red: { tone: "bad", label: "Behind pace" },
};

/** The dashboard's pace card: label + state tag, the figure, the track with its today mark. */
function PaceBar({
  now,
  goal,
  pct,
  todayPct,
  state,
  compact = false,
  inset = false,
}: {
  now: string;
  goal: string;
  pct: number;
  todayPct: number;
  state: PaceState;
  compact?: boolean;
  inset?: boolean;
}) {
  const b = PACE_BADGE[state];
  const trackCls = `lp-track${state === "amber" ? " is-slip" : state === "red" ? " is-behind" : ""}`;
  const vars = { "--lp-pct": `${pct}%`, "--lp-today": `${todayPct}%` } as CSSProperties;
  return (
    <Card inset={inset} className="lp-pace">
      <div className="lp-pace-top">
        <span className="lp-label">Pay Period Pace{compact ? "" : " · 9 days left"}</span>
        <Badge tone={b.tone}>{b.label}</Badge>
      </div>
      <div className={`lp-bigline${compact ? " is-compact" : ""}`}>
        <span>
          <b className="num">{now}</b>
          <span className="unit">flag hrs</span>
        </span>
        <span className="lp-goal">Goal {goal}</span>
      </div>
      <div className={trackCls} style={vars} aria-hidden="true">
        <i />
        <span className="mk">
          <span>TODAY</span>
        </span>
      </div>
    </Card>
  );
}

function bars(values: number[], labels: string[]): ChartBar[] {
  const max = Math.max(...values);
  return values.map((value, i) => ({
    label: labels[i] ?? "",
    longLabel: labels[i] ?? "",
    value,
    isBest: value === max,
    isCurrent: i === values.length - 1,
  }));
}

/** The dashboard's HoursChart on sample data. Hover state is local and does nothing else. */
function SampleChart({
  values,
  labels,
  tab,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  tab: "week" | "month";
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <HoursChart
      bars={bars(values, labels)}
      hover={hover}
      setHover={setHover}
      tab={tab}
      mode="total"
      ariaLabel={ariaLabel}
    />
  );
}

function ROForm() {
  return (
    <div>
      <Field label="RO Number" htmlFor="lp-demo-ro">
        <input id="lp-demo-ro" className="input num" value="48213" readOnly tabIndex={-1} />
      </Field>
      <Field label="Op Code" htmlFor="lp-demo-op" hint="Front brake job · 2.4 hrs">
        <input id="lp-demo-op" className="input num" value="BRK-FR" readOnly tabIndex={-1} />
      </Field>
      <div className="lp-form-acts" aria-hidden="true">
        <span className="btn btn-go">Save &amp; New</span>
        <span className="btn btn-line">Save</span>
      </div>
    </div>
  );
}

function OpCodeList() {
  const kids = [
    { code: "BRK-FR", desc: "Front", hrs: "2.4" },
    { code: "BRK-RR", desc: "Rear", hrs: "2.1" },
    { code: "BRK-FL", desc: "Flush", hrs: "0.6" },
  ];
  return (
    <div className="rows">
      <div>
        <span className="lp-codes">
          <Badge chip mono>BRK</Badge>
          <b>Brake Job</b>
        </span>
        <span className="v">—</span>
      </div>
      {kids.map((r) => (
        <div key={r.code} className="lp-indent">
          <span className="lp-codes">
            <Badge chip mono>{r.code}</Badge>
            <span className="k">{r.desc}</span>
          </span>
          <span className="v num">{r.hrs}</span>
        </div>
      ))}
      <div>
        <span className="lp-codes">
          <Badge chip mono>SUSP</Badge>
          <b>Suspension</b>
        </span>
        <span className="v">3 sub-codes</span>
      </div>
    </div>
  );
}

function DiscrepancyCard() {
  return (
    <div>
      <div className="rows">
        <div>
          <span className="k">Shop flagged</span>
          <span className="v num">64.2 <span className="unit">hrs</span></span>
        </div>
        <div>
          <span className="k">You clocked</span>
          <span className="v num">66.5 <span className="unit">hrs</span></span>
        </div>
        <div>
          <span className="k">Discrepancy</span>
          <span className="v num lp-bad">−2.3 <span className="unit">hrs</span></span>
        </div>
      </div>
      <StatusField tag="Cost" inset>
        3 ROs may be missing hours. Check before payday.
      </StatusField>
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
    <ul className="tags">
      {rows.map((r) => (
        <li key={r.code} className="tag">
          <span className="tag-hole" aria-hidden="true" />
          <div className="tag-head">
            <Badge chip mono>{r.code}</Badge>
            <span className="tag-when">{r.t}</span>
          </div>
          <div className="tag-hrs-cell">
            <span className="tag-hrs">
              {r.hrs}
              <span className="unit">hrs</span>
            </span>
          </div>
          <div className="tag-body" />
        </li>
      ))}
    </ul>
  );
}

/* ── Sections ────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="lp-nav">
      <div className="lp-wrap lp-nav-in">
        <Link href="/" className="logo">
          <LogoMark />
          <LogoWord />
        </Link>
        <div className="lp-nav-acts">
          <Link href="/guest" className="btn btn-quiet lp-nav-hide">
            Try as guest
          </Link>
          <Link href="/signin" className="btn btn-line lp-nav-hide">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-go">
            Create free account
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const values = [4.2, 5.5, 3.8, 6.7, 4.9, 7.2, 5.8, 8.0, 6.1, 4.4, 6.9, 8.8, 5.2, 7.5];
  const labels = values.map((_, i) => String(i + 1));
  return (
    <header className="lp-hero">
      <div className="lp-wrap">
        <Rv>
          <h1>Every RO you log makes you harder to short.</h1>
        </Rv>

        <Rv delay={60}>
          <p className="lp-lede">
            FRT turns your daily work into a record that compounds: proof you got paid right,
            numbers that show your worth, and leverage that grows every single job. Start today;
            thank yourself in a year.
          </p>
        </Rv>

        <Rv delay={120}>
          <div className="lp-ctas">
            <Link href="/signup" className="btn btn-go btn-lg">
              Create free account
            </Link>
            <Link href="/guest" className="btn btn-line btn-lg">
              Try it first{" "}
              <span className="lp-arrow">— no account →</span>
            </Link>
          </div>
          <p className="lp-fine">Free to start · Works on your phone in the bay</p>
        </Rv>

        {/* Dashboard sample */}
        <Rv delay={180} className="lp-demo">
          <Head>
            <HeadCells className="lp-cells">
              <HeadCell label="Today" value="6.4" unit="hrs" sub="112% eff" />
              <HeadCell label="This Week" value="38.1" unit="hrs" sub="104% eff" />
              <HeadCell label="Pay Period" value="64.2" unit="hrs" sub="98% eff" />
              <HeadCell label="This Month" value="142" unit="hrs" sub="101% eff" />
            </HeadCells>
          </Head>
          <div className="lp-demo-row">
            <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" />
            <Card>
              <div className="lp-pace-top">
                <span className="lp-label">Flag hrs · 14 days</span>
              </div>
              <SampleChart values={values} labels={labels} tab="month" ariaLabel="Flag hours over the last 14 days, sample data" />
            </Card>
          </div>
        </Rv>
      </div>
    </header>
  );
}

function PaceSection() {
  return (
    <section className="lp-sec">
      <div className="lp-wrap">
        <div className="lp-narrow">
          <Rv>
            <h2>See your pace at a glance.</h2>
          </Rv>
          <Rv delay={60}>
            <p className="lp-lede">
              One bar shows everything: how many flag hours you&apos;ve banked, your goal, and a{" "}
              <strong>today</strong>{" "}tick for exactly where you should be.
              Green means you&apos;re good. Color shifts the second you start slipping.
            </p>
          </Rv>
        </div>

        <Rv delay={100} className="lp-pace-set">
          <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" />
          <div className="lp-pace-two">
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
      t: "Keep your own books.",
      d: "Most shops know techs don't track their own hours, and some count on it. When flagged time doesn't show up on your check, there's no record to push back with. FRT is that record.",
    },
    {
      t: "Know before payday.",
      d: "A live pace bar tracks where you stand against your pay period goal every time you log an RO. If you're slipping, you'll see it with time to fix it, not after the check is already cut.",
    },
    {
      t: "Build a record only you control.",
      d: "Every RO you log builds a real picture of how you perform: efficiency rates, average flag hours, the jobs you run most. Yours to keep, no matter which shop you're standing in.",
    },
  ];
  return (
    <section className="lp-sec is-flush-top">
      <div className="lp-wrap">
        <Rv>
          <h2>You flag the hours. Make sure you get paid for every one.</h2>
        </Rv>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <Rv key={s.t} delay={i * 90} className="lp-step">
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </Rv>
          ))}
        </div>
      </div>
    </section>
  );
}

function LongGame() {
  return (
    <section className="lp-sec is-flush-top">
      <div className="lp-wrap">
        <div className="lp-narrow">
          <Rv>
            <h2>Day one, it tracks a job. Year one, it tracks your career.</h2>
          </Rv>
          <Rv delay={60}>
            <p className="lp-lede">
              Every RO you log is one more data point in the only record that&apos;s actually
              yours. <strong>Day one</strong>, it catches a shorted
              check. <strong>Month six</strong>, it shows your real
              efficiency across every job type. <strong>Year one</strong>,
              it&apos;s the case you put on the service manager&apos;s desk when it&apos;s time to
              talk money, or the proof you take to a better shop. Most techs throw that record
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
    desc: "Today, this week, pay period, this month: flag hours, clocked hours, and efficiency. No estimates.",
    visual: (
      <dl className="spec">
        <div><dt>Today</dt><dd>6.4<small>h · 112%</small></dd></div>
        <div><dt>Week</dt><dd>38.1<small>h · 104%</small></dd></div>
        <div><dt>Pay Period</dt><dd>64.2<small>h · 98%</small></dd></div>
        <div><dt>Month</dt><dd>142<small>h · 101%</small></dd></div>
      </dl>
    ),
  },
  {
    tag: "Pay Period Pace",
    title: "Know if you'll make it",
    desc: "A live bar against your goal with a today tick, and an at-a-glance pill: on pace, slightly behind, behind.",
    visual: <PaceBar now="64.2" goal="88" pct={73} todayPct={68} state="green" compact inset />,
  },
  {
    tag: "RO Logging",
    title: "Logged in two taps",
    desc: "RO number plus op code. Snap a photo of the repair order and the fields fill themselves, or type it by hand. Hit Save & New and start the next job.",
    visual: <ROForm />,
  },
  {
    tag: "Op Code Library",
    title: "Your codes, your way",
    desc: 'Build a personal library with parent / child codes: "Brake Job" → Front, Rear, Flush. Stop retyping.',
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
      <div>
        <SampleChart
          values={[4.0, 5.8, 4.6, 7.0, 5.5, 7.8, 6.2]}
          labels={["M", "T", "W", "T", "F", "S", "S"]}
          tab="week"
          ariaLabel="Flag hours by day, sample data"
        />
        <HistoryRows />
      </div>
    ),
  },
];

function Features() {
  return (
    <section id="features" className="lp-sec is-flush-top">
      <div className="lp-wrap">
        <div className="lp-narrow">
          <Rv>
            <h2>Made for the bay, not the boardroom.</h2>
          </Rv>
        </div>

        <div className="lp-feats">
          {featCards.map((f, i) => (
            <Rv key={f.tag} delay={(i % 3) * 80} className="lp-feat card padded">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <div className="lp-feat-vis">{f.visual}</div>
            </Rv>
          ))}
        </div>
      </div>
    </section>
  );
}

function GuestMode() {
  return (
    <section className="lp-sec lp-guest">
      <div className="lp-wrap">
        <div className="lp-guest-grid">
          <div>
            <Rv>
              <h2>No account? No problem.</h2>
            </Rv>
            <Rv delay={60}>
              <p className="lp-lede">
                Log ROs, check your stats, watch your pace: the whole app, no signup. Your data
                stays in your browser. Make an account when you&apos;re ready to keep it.
              </p>
            </Rv>
            <Rv delay={120}>
              <Link href="/guest" className="btn btn-go btn-lg">
                Try it first — no account needed
              </Link>
            </Rv>
          </div>

          <Rv delay={120} className="card padded">
            <div className="lp-sess-top">
              <Badge tone="brand">● Guest session</Badge>
              <span className="lp-label">saved locally</span>
            </div>
            <ul className="lp-checks">
              {[
                "Log unlimited repair orders",
                "Full dashboard & pace tracking",
                "Op code library & history",
                "Job timer with PiP mode",
              ].map((item) => (
                <li key={item}>
                  <span className="lp-check">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 8.5L6.5 12L13 4.5" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="lp-sess-note">
              Nothing leaves your phone until you create an account, then it all syncs over.
            </p>
          </Rv>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="lp-sec lp-final">
      <div className="lp-wrap">
        <div className="lp-narrow">
          <Rv>
            <h2>Nobody&apos;s looking out for the tech. So we built the tool that does.</h2>
          </Rv>
          <Rv delay={60}>
            <p className="lp-lede">
              Set up in under a minute. See exactly where your pay period stands by your next RO.
            </p>
          </Rv>
          <Rv delay={120}>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn-go btn-lg">
                Create free account
              </Link>
              <Link href="/guest" className="lp-textlink">
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
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-in">
        <Link href="/" className="logo">
          <LogoMark />
          <LogoWord />
        </Link>
        <div className="lp-foot-links">
          {[
            { label: "Features", href: "#features" },
            { label: "Guest mode", href: "/guest" },
            { label: "Sign in", href: "/signin" },
          ].map((l) => (
            <Link key={l.label} href={l.href} className="lp-flink">
              {l.label}
            </Link>
          ))}
        </div>
        <span className="lp-copy">© 2026 Flat Rate Tracker</span>
      </div>
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────── */
export default function LandingPage() {
  useReveal();
  return (
    <div id="lp" className="lp">
      <Nav />
      <main>
        <Hero />
        <PaceSection />
        <HowItWorks />
        <LongGame />
        <Features />
        <GuestMode />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
