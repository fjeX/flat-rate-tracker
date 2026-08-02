"use client";

// The Pay Period page's title row.
//
// Replaces two things the page used to spend vertical space on: a static
// "Pay Period" <h1> that duplicated the nav label and told you nothing, and a
// full card holding the period <select> plus the custom-date buttons.
//
// The period IS the title. Stepping to the neighbouring period — by far the
// common case — is one tap on the chevrons. Jumping to an old period, and
// resetting custom dates, live in the menu behind the title.
//
// Custom dates do NOT: they sit beside the status pill. A tech reading their
// paystub and correcting FRT to match is doing the ordinary thing this page
// exists for, and a menu is where you put the things people rarely need.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatPeriodLabel, type PeriodRange } from "@/lib/periods";
import type { PeriodMode } from "@/lib/period-mode";

// The status is a pill, not fine print: on a page whose whole shape changes
// with the mode, "which kind of period am I looking at" is the first thing a
// user needs and the easiest thing to miss. Colour carries it too, so it reads
// before the words do.
function statusFor(
  mode: PeriodMode,
  isCurrent: boolean,
): { label: string; tone: string } {
  if (mode === "settled") return { label: "Paid", tone: "" };
  if (mode === "awaiting_pay")
    return { label: "Closed — waiting on pay", tone: "warn" };
  return {
    label: isCurrent ? "Current pay period" : "In progress",
    tone: "brand",
  };
}

export function PeriodTitleBar({
  availablePeriods,
  selected,
  currentKey,
  hasOverride,
  mode,
  onPick,
  onEditDates,
  onResetDates,
  resetting = false,
}: {
  // Sorted newest-first by the page, which is the order the menu shows.
  availablePeriods: PeriodRange[];
  selected: PeriodRange;
  currentKey: string;
  hasOverride: boolean;
  mode: PeriodMode;
  onPick: (key: string) => void;
  onEditDates: () => void;
  onResetDates: () => void;
  resetting?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const index = availablePeriods.findIndex((p) => p.key === selected.key);
  // availablePeriods is newest-first, so "previous period" is the NEXT index.
  const olderKey =
    index >= 0 && index < availablePeriods.length - 1
      ? availablePeriods[index + 1].key
      : null;
  const newerKey = index > 0 ? availablePeriods[index - 1].key : null;

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Scroll the selected period into view when the menu opens — with a couple of
  // years of history the current period would otherwise be off-screen.
  useEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const active = menuRef.current.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "center" });
  }, [menuOpen]);

  function pick(key: string) {
    setMenuOpen(false);
    onPick(key);
  }

  const status = statusFor(mode, selected.key === currentKey);

  return (
    <div className="period-titlebar">
      <button
        type="button"
        className="period-step"
        onClick={() => olderKey && onPick(olderKey)}
        disabled={olderKey === null}
        aria-label="Last pay period"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="period-step-label">Last pay period</span>
      </button>

      {/* Status sits BESIDE the date, not under it: it reads as part of the
          title ("Jul 16 – 31, current pay period") rather than as a caption,
          and it keeps the header one line tall. Wraps below the title only when
          the viewport genuinely can't fit both. */}
      <div className="period-title-main">
        <button
          type="button"
          className="period-title-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <h1>{formatPeriodLabel(selected)}</h1>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--fg-3)]" />
        </button>
        <span className={`pill ${status.tone}`}>{status.label}</span>
        {/* Setting the real dates off a paystub is a routine task, not an
            advanced one — it was buried behind the title menu, which read as
            "somewhere in settings". It sits beside the status now, where the
            question "what dates is this actually covering?" gets asked.
            When dates are already custom the pill states that, so the button
            only has to offer the verb. */}
        {hasOverride ? (
          <>
            <span className="pill neutral">Custom dates</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onEditDates}
              aria-label="Edit custom period dates"
            >
              Edit
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onEditDates}
          >
            Set custom dates
          </button>
        )}
      </div>

      <button
        type="button"
        className="period-step"
        onClick={() => newerKey && onPick(newerKey)}
        disabled={newerKey === null}
        aria-label="Next pay period"
      >
        <span className="period-step-label">Next pay period</span>
        <ChevronRight className="h-4 w-4 shrink-0" />
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            className="period-menu-scrim"
            aria-label="Close period menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="period-menu" ref={menuRef} role="menu">
            <div className="period-menu-list">
              {availablePeriods.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="menuitem"
                  data-active={p.key === selected.key}
                  className="period-menu-item"
                  onClick={() => pick(p.key)}
                >
                  <span>{formatPeriodLabel(p)}</span>
                  {p.key === currentKey && (
                    <span className="period-menu-tag">current</span>
                  )}
                </button>
              ))}
            </div>
            {/* Custom dates moved out to the title row. Leaving a second entry
                here would mean two paths to one modal — and the one in the menu
                would be the one nobody found. Reset stays: it only exists once
                dates are custom, and it belongs next to the list it undoes. */}
            {hasOverride && (
              <div className="period-menu-actions">
                <button
                  type="button"
                  role="menuitem"
                  className="period-menu-item"
                  disabled={resetting}
                  onClick={() => {
                    setMenuOpen(false);
                    onResetDates();
                  }}
                >
                  {resetting ? "Resetting…" : "Reset to default dates"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
