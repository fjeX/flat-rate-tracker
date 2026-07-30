"use client";

// The Pay Period page's title row.
//
// Replaces two things the page used to spend vertical space on: a static
// "Pay Period" <h1> that duplicated the nav label and told you nothing, and a
// full card holding the period <select> plus the custom-date buttons.
//
// The period IS the title. Stepping to the neighbouring period — by far the
// common case — is one tap on the chevrons. Everything else (jumping to an old
// period, custom dates, reset) lives in one menu behind the title, so there's a
// single place to look rather than a card and a dropdown.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatPeriodLabel, type PeriodRange } from "@/lib/periods";
import type { PeriodMode } from "@/lib/period-mode";

function subtitleFor(
  mode: PeriodMode,
  isCurrent: boolean,
  hasOverride: boolean,
): string {
  const base =
    mode === "settled"
      ? "Paid — reconciled below"
      : mode === "awaiting_pay"
        ? "Closed · waiting on pay"
        : isCurrent
          ? "Current period"
          : "In progress";
  return hasOverride ? `${base} · custom dates` : base;
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

  return (
    <div className="period-titlebar">
      <button
        type="button"
        className="period-step"
        onClick={() => olderKey && onPick(olderKey)}
        disabled={olderKey === null}
        aria-label="Previous pay period"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

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
        <p className="period-title-sub">
          {subtitleFor(mode, selected.key === currentKey, hasOverride)}
        </p>
      </div>

      <button
        type="button"
        className="period-step"
        onClick={() => newerKey && onPick(newerKey)}
        disabled={newerKey === null}
        aria-label="Next pay period"
      >
        <ChevronRight className="h-4 w-4" />
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
            <div className="period-menu-actions">
              <button
                type="button"
                role="menuitem"
                className="period-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onEditDates();
                }}
              >
                {hasOverride ? "Edit custom dates" : "Set custom dates"}
              </button>
              {hasOverride && (
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
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
