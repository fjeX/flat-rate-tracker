"use client";

// The Pay Period page's title area, built from final.html #screen-pay-period:
// the page title with the status marker beside it, then the picker row
// (last period, the period itself as a menu button, next period), then the
// custom-dates control under it.
//
// Behaviour is unchanged from the version this replaces: stepping to the
// neighbouring period is one tap, jumping to an old period and resetting custom
// dates live in the menu behind the period button, and setting custom dates is
// a plain button beside the status rather than a menu entry (a tech correcting
// FRT to match a paystub is doing the ordinary thing this page exists for).
import { useEffect, useRef, useState } from "react";
import { formatPeriodLabel, type PeriodRange } from "@/lib/periods";
import type { PeriodMode } from "@/lib/period-mode";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PpIcon } from "./PpParts";

// The status is a tagged marker beside the title: on a page whose whole shape
// changes with the mode, "which kind of period am I looking at" is the first
// thing a user needs. Good (green, with a drawn check) for a live or paid
// period; a neutral outline for one that is closed and still waiting on pay.
function statusFor(
  mode: PeriodMode,
  isCurrent: boolean,
): { label: string; good: boolean } {
  if (mode === "settled") return { label: "Paid", good: true };
  if (mode === "awaiting_pay")
    return { label: "Closed — waiting on pay", good: false };
  return { label: isCurrent ? "Current pay period" : "In progress", good: true };
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
  const label = formatPeriodLabel(selected);

  return (
    <div className="pp-titlebar">
      <div className="pp-head">
        <div className="pp-grow">
          <h1>Pay period</h1>
        </div>
        <span className={`pp-marker${status.good ? "" : " is-note"}`}>
          {status.good && <PpIcon name="check" />}
          {status.label}
        </span>
      </div>

      <div className="pp-picker-wrap">
        <div className="pp-picker">
          <Button
            variant="line"
            className="btn-field"
            onClick={() => olderKey && onPick(olderKey)}
            disabled={olderKey === null}
            aria-label="Last pay period"
          >
            <PpIcon name="chev" style={{ transform: "rotate(90deg)" }} />
            <span className="lbl" aria-hidden="true">Last pay period</span>
          </Button>

          <button
            type="button"
            className="pp-pick"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Pay period ${label}, choose another`}
          >
            <span>{label}</span>
            <PpIcon name="chev" className="chev" />
          </button>

          <Button
            variant="line"
            className="btn-field"
            onClick={() => newerKey && onPick(newerKey)}
            disabled={newerKey === null}
            aria-label="Next pay period"
          >
            <span className="lbl" aria-hidden="true">Next pay period</span>
            <PpIcon name="chev" style={{ transform: "rotate(-90deg)" }} />
          </Button>
        </div>

        {menuOpen && (
          <>
            <button
              type="button"
              className="pp-menu-scrim"
              aria-label="Close period menu"
              onClick={() => setMenuOpen(false)}
            />
            <div className="pp-menu" ref={menuRef} role="menu">
              <div className="pp-menu-list">
                {availablePeriods.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="menuitem"
                    data-active={p.key === selected.key}
                    className="pp-menu-item"
                    onClick={() => pick(p.key)}
                  >
                    <span>{formatPeriodLabel(p)}</span>
                    {p.key === currentKey && (
                      <span className="pp-menu-tag">current</span>
                    )}
                  </button>
                ))}
              </div>
              {/* Custom dates live beside the title, not here. Leaving a second
                  entry here would mean two paths to one modal — and the one in
                  the menu would be the one nobody found. Reset stays: it only
                  exists once dates are custom, and it belongs next to the list
                  it undoes. */}
              {hasOverride && (
                <div className="pp-menu-actions">
                  <button
                    type="button"
                    role="menuitem"
                    className="pp-menu-item"
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

      {/* Setting the real dates off a paystub is a routine task, not an
          advanced one. When dates are already custom the tag says so and the
          button only has to offer the verb. */}
      <div className="pp-picker-more">
        {hasOverride ? (
          <>
            <Badge tone="neutral">Custom dates</Badge>
            <Button
              variant="quiet"
              onClick={onEditDates}
              aria-label="Edit custom period dates"
            >
              Edit
            </Button>
          </>
        ) : (
          <Button variant="quiet" onClick={onEditDates}>
            Set custom dates
          </Button>
        )}
      </div>
    </div>
  );
}
