// The three page bodies rendered under each design direction.
// One DOM per page; `dir` branches only where a direction's point of view
// demands a different structure (e.g. A renders history as a data table).

import {
  Camera,
  ChevronDown,
  type Dir,
  PvBadge,
  PvBars,
  PvButton,
  PvCard,
  PvField,
  PvInput,
  PvProgress,
  PvStat,
  ScanLine,
  Search,
} from "./components";
import {
  DAILY_BARS,
  ENTRIES,
  FORM_LINES,
  PACE,
  QUICK_CHIPS,
  STATS,
} from "./mock-data";

const fmt = (n: number) => n.toFixed(1);

/* ══ Dashboard ═══════════════════════════════════════════ */

export function DashboardBody({ dir }: { dir: Dir }) {
  return (
    <div className="pv-stack">
      {/* Greeting + pace */}
      <PvCard flush>
        <div className="pv-greeting">
          <span className="pv-avatar pv-avatar-lg">L</span>
          <div className="pv-greeting-text">
            <h1 className="pv-h1">Wednesday, July 8</h1>
            <p className="pv-sub">3 ROs logged · last one 22 min ago</p>
          </div>
          <PvBadge tone="warn">Close</PvBadge>
        </div>
        <div className="pv-cardrule" />
        <div className="pv-pace">
          <div className="pv-pace-head">
            <span className="pv-label">Pay Period Pace</span>
            <span className="pv-label-meta">{PACE.daysLeft} days left</span>
          </div>
          <div className="pv-pace-values">
            <span className="pv-pace-now pv-num">
              {fmt(PACE.current)}
              <span className="pv-pace-unit"> flag hrs</span>
            </span>
            <span className="pv-pace-goal pv-num">Goal {PACE.goal}</span>
          </div>
          <PvProgress pct={PACE.pct} tickPct={PACE.todayPct} />
          <p className="pv-pace-forecast">
            On pace for about <b className="pv-num">{PACE.projected}</b> of {PACE.goal} flag
            hrs — flag about <b className="pv-num">{PACE.requiredPerDay}</b> more hrs/day to
            close the gap.
          </p>
          <div className="pv-pace-foot">
            <span>{PACE.periodLabel}</span>
            <span className="pv-num">{STATS.period.eff}% eff</span>
          </div>
        </div>
      </PvCard>

      {/* Stat tiles */}
      <div className="pv-statgrid">
        <PvStat label="Today" value={fmt(STATS.today.flag)} unit=" hrs" sub={`${STATS.today.ros} ROs · ${STATS.today.eff}% eff`} tone="good" />
        <PvStat label="This Week" value={fmt(STATS.week.flag)} unit=" hrs" sub={`${STATS.week.ros} ROs · ${STATS.week.eff}% eff`} />
        <PvStat label="Pay Period" value={fmt(STATS.period.flag)} unit=" hrs" sub={`${STATS.period.ros} ROs · ${STATS.period.eff}% eff`} />
        <PvStat label="This Month" value={fmt(STATS.month.flag)} unit=" hrs" sub={`${STATS.month.ros} ROs · ${STATS.month.eff}% eff`} />
      </div>

      {/* Recent ROs */}
      <section>
        <div className="pv-sectionhead">
          <h2 className="pv-sectiontitle">Recent ROs</h2>
          <span className="pv-link">View all →</span>
        </div>
        <PvCard flush>
          <ul className="pv-rolist">
            {ENTRIES.slice(0, 4).map((e) => (
              <li className="pv-rorow" key={e.ro}>
                <div className="pv-rorow-main">
                  <span className="pv-ronum pv-num">
                    #{e.ro}
                    {e.hasPhoto && <Camera size={13} className="pv-rophoto" aria-label="Has photo" />}
                  </span>
                  <span className="pv-rometa">{e.dateLine}</span>
                  <span className="pv-rovehicle">{e.vehicle}</span>
                </div>
                <div className="pv-rocodes">
                  {e.lines.slice(0, 2).map((l) => (
                    <PvBadge key={l.code}>{l.code}</PvBadge>
                  ))}
                  {e.lines.length > 2 && <PvBadge>+{e.lines.length - 2}</PvBadge>}
                </div>
                <span className="pv-rohours pv-num">{fmt(e.hours)}</span>
              </li>
            ))}
          </ul>
        </PvCard>
      </section>

      {/* Averages chart */}
      <PvCard>
        <div className="pv-sectionhead pv-sectionhead-incard">
          <h2 className="pv-sectiontitle">Daily flag hours</h2>
          <span className="pv-label-meta">Last 14 days</span>
        </div>
        <PvBars bars={DAILY_BARS} highlightLast />
        <div className="pv-chart-foot">
          <span>
            Avg <b className="pv-num">7.1</b> hrs/working day
          </span>
          <span>
            Best <b className="pv-num">9.8</b>
          </span>
        </div>
      </PvCard>
    </div>
  );
}

/* ══ Log RO ══════════════════════════════════════════════ */

export function LogBody({ dir }: { dir: Dir }) {
  const totalFlag = FORM_LINES.reduce((s, l) => s + l.flag, 0);
  return (
    <div className="pv-stack pv-logform">
      {/* Step 1 — RO number */}
      <PvCard className="pv-step active">
        <div className="pv-step-head">
          <span className="pv-step-num">1</span>
          <span className="pv-step-title">Repair order</span>
        </div>
        <div className="pv-step-body">
          <div className="pv-ro-entry">
            <PvField label="RO number">
              <PvInput placeholder="48292" defaultValue="48292" mono />
            </PvField>
            <PvButton variant="ghost">
              <ScanLine size={16} />
              Scan RO
            </PvButton>
          </div>
        </div>
      </PvCard>

      {/* Step 2 — Op codes */}
      <PvCard className="pv-step active">
        <div className="pv-step-head">
          <span className="pv-step-num">2</span>
          <span className="pv-step-title">Op codes</span>
          <span className="pv-step-total pv-num">{fmt(totalFlag)} hrs</span>
        </div>
        <div className="pv-step-body">
          <div className="pv-search">
            <Search size={15} className="pv-search-icon" />
            <PvInput placeholder="Search op codes…" />
          </div>
          <div className="pv-chiprow">
            {QUICK_CHIPS.map((c) => (
              <span className="pv-chip" key={c}>
                {c}
              </span>
            ))}
          </div>
          <ul className="pv-oplines">
            {FORM_LINES.map((l) => (
              <li className="pv-opline" key={l.code}>
                <div className="pv-opline-main">
                  <span className="pv-opcode pv-num">{l.code}</span>
                  <span className="pv-opdesc">{l.desc}</span>
                </div>
                <span className="pv-ophours pv-num">{fmt(l.flag)}</span>
                <span className="pv-opline-remove" aria-label={`Remove ${l.code}`}>
                  ×
                </span>
              </li>
            ))}
          </ul>
          <PvButton variant="ghost" size="sm">
            + Custom line
          </PvButton>
        </div>
      </PvCard>

      {/* Step 3 — Vehicle (expanded to show form fields) */}
      <PvCard className="pv-step active">
        <div className="pv-step-head">
          <span className="pv-step-num">3</span>
          <span className="pv-step-title">
            Vehicle <span className="pv-optional">optional</span>
          </span>
          <ChevronDown size={15} className="pv-step-chev" />
        </div>
        <div className="pv-step-body">
          <div className="pv-fieldgrid">
            <PvField label="Year">
              <PvInput placeholder="2021" defaultValue="2021" mono />
            </PvField>
            <PvField label="Make">
              <PvInput placeholder="Ford" defaultValue="Ford" />
            </PvField>
            <PvField label="Model">
              <PvInput placeholder="F-150" defaultValue="F-150" />
            </PvField>
          </div>
          <PvField label="VIN" hint="Scans auto-fill year / make / model">
            <PvInput placeholder="1FTFW1E52MFA…" mono />
          </PvField>
          <PvField label="Mileage" error="Numbers only — got “84,2k1”">
            <PvInput placeholder="84,201" defaultValue="84,2k1" mono />
          </PvField>
        </div>
      </PvCard>

      {/* Step 4 — Notes (collapsed) */}
      <PvCard className="pv-step collapsed">
        <div className="pv-step-head">
          <span className="pv-step-num">4</span>
          <span className="pv-step-title">
            Notes <span className="pv-optional">optional</span>
          </span>
          <span className="pv-step-summary">Customer states grinding noise front…</span>
          <ChevronDown size={15} className="pv-step-chev" />
        </div>
      </PvCard>

      {/* Sticky save bar */}
      <div className="pv-savebar">
        <span className="pv-savebar-summary">
          RO <b className="pv-num">#48292</b> · 2021 Ford F-150 · 2 op codes ·{" "}
          <b className="pv-num">{fmt(totalFlag)} hrs</b>
        </span>
        <PvButton variant="primary" size="lg">
          Save RO
        </PvButton>
      </div>
    </div>
  );
}

/* ══ History ═════════════════════════════════════════════ */

export function HistoryBody({ dir }: { dir: Dir }) {
  const total = ENTRIES.reduce((s, e) => s + e.hours, 0);
  return (
    <div className="pv-stack">
      {/* Summary + chart */}
      <PvCard>
        <div className="pv-hist-summary">
          <PvStat label="Pay period" value={fmt(STATS.period.flag)} unit=" hrs" sub={`${STATS.period.ros} ROs`} />
          <PvStat label="Efficiency" value={`${STATS.period.eff}`} unit="%" sub="vs clocked" tone="good" />
          <PvStat label="Earnings" value="$2,184" sub="priced lines only" />
        </div>
        <PvBars bars={DAILY_BARS} highlightLast />
      </PvCard>

      {/* Filters */}
      <div className="pv-filterbar">
        <div className="pv-chiprow">
          {["Today", "Week", "Period", "Month", "All"].map((c, i) => (
            <span className={`pv-chip${i === 2 ? " active" : ""}`} key={c}>
              {c}
            </span>
          ))}
        </div>
        <div className="pv-search">
          <Search size={15} className="pv-search-icon" />
          <PvInput placeholder="RO #, vehicle, op code…" />
        </div>
      </div>

      {/* Rows — direction A renders a scan-tool data table; B and C render row cards */}
      {dir === "a" ? (
        <PvCard flush>
          <table className="pv-table">
            <thead>
              <tr>
                <th>RO</th>
                <th>Logged</th>
                <th>Vehicle</th>
                <th>Op codes</th>
                <th className="pv-table-num">Flag</th>
              </tr>
            </thead>
            <tbody>
              {ENTRIES.map((e) => (
                <tr key={e.ro}>
                  <td className="pv-num">
                    #{e.ro}
                    {e.hasPhoto && <Camera size={12} className="pv-rophoto" aria-label="Has photo" />}
                  </td>
                  <td className="pv-table-dim">{e.dateLine}</td>
                  <td>{e.vehicle}</td>
                  <td className="pv-table-codes">
                    {e.lines.map((l) => (
                      <PvBadge key={l.code}>{l.code}</PvBadge>
                    ))}
                  </td>
                  <td className="pv-table-num pv-num">{fmt(e.hours)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{ENTRIES.length} ROs</td>
                <td className="pv-table-num pv-num">{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </PvCard>
      ) : (
        <PvCard flush>
          <ul className="pv-rolist">
            {ENTRIES.map((e) => (
              <li className="pv-rorow" key={e.ro}>
                <div className="pv-rorow-main">
                  <span className="pv-ronum pv-num">
                    #{e.ro}
                    {e.hasPhoto && <Camera size={13} className="pv-rophoto" aria-label="Has photo" />}
                  </span>
                  <span className="pv-rometa">{e.dateLine}</span>
                  <span className="pv-rovehicle">{e.vehicle}</span>
                </div>
                <div className="pv-rocodes">
                  {e.lines.slice(0, 2).map((l) => (
                    <PvBadge key={l.code}>{l.code}</PvBadge>
                  ))}
                  {e.lines.length > 2 && <PvBadge>+{e.lines.length - 2}</PvBadge>}
                </div>
                <span className="pv-rohours pv-num">{fmt(e.hours)}</span>
              </li>
            ))}
          </ul>
          <div className="pv-listfoot">
            <span>{ENTRIES.length} ROs shown</span>
            <span className="pv-num">{fmt(total)} hrs</span>
          </div>
        </PvCard>
      )}
    </div>
  );
}
