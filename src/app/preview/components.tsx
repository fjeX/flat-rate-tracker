// Shared primitives + app chrome for the /preview design-direction prototypes.
// Every visual decision lives in preview.css behind tokens — these components
// only carry structure. `dir` branches exist only where directions genuinely
// differ in DOM shape, not styling.

import Link from "next/link";
import {
  Camera,
  ChevronDown,
  Gauge,
  History,
  Home,
  Plus,
  ScanLine,
  Search,
  Settings,
  Timer,
  Wrench,
} from "lucide-react";

export type Dir = "a" | "b" | "c";
export type PageKey = "dashboard" | "log" | "history";
export type Theme = "dark" | "light";

export const DIR_NAMES: Record<Dir, string> = {
  a: "Instrument Cluster",
  b: "Calm Workspace",
  c: "Tactile Shop Tool",
};

export function previewHref(dir: Dir, page: PageKey, theme: Theme, chrome: boolean) {
  const q = new URLSearchParams();
  if (theme === "light") q.set("theme", "light");
  if (!chrome) q.set("chrome", "0");
  const qs = q.toString();
  return `/preview/${dir}/${page}${qs ? `?${qs}` : ""}`;
}

/* ── Primitives ────────────────────────────────────────── */

export function PvButton({
  variant = "default",
  size,
  block,
  children,
}: {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "lg";
  block?: boolean;
  children: React.ReactNode;
}) {
  const cls = [
    "pv-btn",
    variant !== "default" && `pv-btn-${variant}`,
    size && `pv-btn-${size}`,
    block && "pv-btn-block",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls}>
      {children}
    </button>
  );
}

export function PvBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "brand" | "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  return <span className={`pv-badge pv-badge-${tone}`}>{children}</span>;
}

export function PvCard({
  className = "",
  flush,
  children,
}: {
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`pv-card${flush ? " pv-card-flush" : ""} ${className}`.trim()}>
      {children}
    </section>
  );
}

export function PvField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`pv-field${error ? " pv-field-error" : ""}`}>
      <span className="pv-field-label">{label}</span>
      {children}
      {error ? (
        <span className="pv-field-msg pv-field-msg-error">{error}</span>
      ) : hint ? (
        <span className="pv-field-msg">{hint}</span>
      ) : null}
    </div>
  );
}

export function PvInput({
  placeholder,
  defaultValue,
  mono,
}: {
  placeholder?: string;
  defaultValue?: string;
  mono?: boolean;
}) {
  return (
    <input
      className={`pv-input${mono ? " pv-num" : ""}`}
      placeholder={placeholder}
      defaultValue={defaultValue}
      readOnly
    />
  );
}

export function PvStat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={`pv-stat${tone ? ` pv-stat-${tone}` : ""}`}>
      <span className="pv-stat-label">{label}</span>
      <span className="pv-stat-value pv-num">
        {value}
        {unit && <span className="pv-stat-unit">{unit}</span>}
      </span>
      {sub && <span className="pv-stat-sub">{sub}</span>}
    </div>
  );
}

export function PvProgress({ pct, tickPct }: { pct: number; tickPct?: number }) {
  return (
    <div className="pv-progress">
      <div className="pv-progress-fill" style={{ width: `${pct}%` }} />
      {tickPct !== undefined && (
        <div className="pv-progress-tick" style={{ left: `${tickPct}%` }} />
      )}
    </div>
  );
}

export function PvBars({
  bars,
  highlightLast,
}: {
  bars: { day: string; v: number }[];
  highlightLast?: boolean;
}) {
  const max = Math.max(...bars.map((b) => b.v), 1);
  return (
    <div className="pv-bars">
      {bars.map((b, i) => (
        <div className="pv-bars-col" key={i}>
          <div className="pv-bars-track">
            <div
              className={`pv-bars-fill${highlightLast && i === bars.length - 1 ? " current" : ""}${b.v === 0 ? " zero" : ""}`}
              style={{ height: `${Math.max((b.v / max) * 100, b.v === 0 ? 3 : 8)}%` }}
            />
          </div>
          <span className="pv-bars-day">{b.day}</span>
        </div>
      ))}
    </div>
  );
}

/* ── App chrome (mock header + tabs + bottom nav) ─────── */

const TABS: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <Home size={17} /> },
  { key: "log", label: "Log RO", icon: <Plus size={17} /> },
  { key: "history", label: "History", icon: <History size={17} /> },
];

export function PvChrome({
  dir,
  page,
  theme,
  chrome,
  children,
}: {
  dir: Dir;
  page: PageKey;
  theme: Theme;
  chrome: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`pv-root pv-dir-${dir}`} data-theme={theme}>
      {chrome && (
        <nav className="pv-devbar" aria-label="Preview controls">
          <span className="pv-devbar-tag">PREVIEW</span>
          {(["a", "b", "c"] as Dir[]).map((d) => (
            <Link
              key={d}
              href={previewHref(d, page, theme, chrome)}
              className={`pv-devbar-link${d === dir ? " active" : ""}`}
            >
              {d.toUpperCase()} — {DIR_NAMES[d]}
            </Link>
          ))}
          <span className="pv-devbar-spacer" />
          <Link
            href={previewHref(dir, page, theme === "dark" ? "light" : "dark", chrome)}
            className="pv-devbar-link"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </Link>
        </nav>
      )}

      <header className="pv-appbar">
        <div className="pv-brand">
          <span className="pv-brand-mark">
            <Wrench size={16} />
          </span>
          <span className="pv-brand-text">
            <span className="pv-brand-name">Flat Rate Tracker</span>
            <span className="pv-brand-sub">{DIR_NAMES[dir]}</span>
          </span>
        </div>
        <div className="pv-appbar-util">
          <span className="pv-iconbtn">
            <Timer size={18} />
          </span>
          <span className="pv-iconbtn">
            <Settings size={18} />
          </span>
          <span className="pv-avatar">L</span>
        </div>
      </header>

      <nav className="pv-tabs" aria-label="Primary">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={previewHref(dir, t.key, theme, chrome)}
            className={`pv-tab${t.key === page ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
        <span className="pv-tab" aria-hidden>
          Pay Period
        </span>
      </nav>

      <main className="pv-main">{children}</main>

      <nav className="pv-bottomnav" aria-label="Primary mobile">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={previewHref(dir, t.key, theme, chrome)}
            className={`pv-bottomtab${t.key === page ? " active" : ""}`}
          >
            <span className="pv-bottomtab-icon">{t.icon}</span>
            <span className="pv-bottomtab-label">{t.label}</span>
          </Link>
        ))}
        <span className="pv-bottomtab">
          <span className="pv-bottomtab-icon">
            <Gauge size={17} />
          </span>
          <span className="pv-bottomtab-label">Period</span>
        </span>
      </nav>
    </div>
  );
}

export { Camera, ChevronDown, ScanLine, Search };
