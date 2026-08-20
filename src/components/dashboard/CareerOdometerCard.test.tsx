// @vitest-environment jsdom
//
// The last of the private hours formatters (follow-up to
// `dashboard-flag-hours-rounding`). This card had TWO hours figures and TWO
// formatters: the odometer ran its own `toLocaleString` with
// maximumFractionDigits:1 while the legend three lines below already called
// fmtHours. The private one has no sub-resolution floor, so a tech whose entire
// documented history is one 0.02h line — `hours()` is `.min(0)` and the column
// is numeric(5,2), so that record is storable — read "0.0 hrs flagged" under a
// heading claiming to count them.
//
// It is NOT a rounding bug: Intl agrees with fmtHours on every x.x5 case,
// because V8 formats from the shortest decimal representation rather than the
// exact double. Only the floor and the negative asymmetry diverge. What the
// odometer legitimately needed from Intl was thousands grouping, which is why
// fmtHoursGrouped exists.
//
// Assertions read the DOM, not props: RollingNumber shreds its text into
// per-digit strips plus separator spans, so "what does a reader see" is only
// answerable by reassembling it.
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { fmtHours, fmtHoursGrouped } from "@/lib/format";
import { CareerOdometerCard } from "./CareerOdometerCard";

afterEach(cleanup);

/**
 * The odometer readout as a sighted reader sees it, rebuilt from the visual
 * layer alone — separators verbatim, digits decoded from each strip's
 * translateY. Deliberately does NOT consult the sr-only span: the point is to
 * be able to compare the two independently.
 */
function visibleReadout(): string {
  const val = document.querySelector(".gami-odo-val");
  if (!val) throw new Error("no .gami-odo-val rendered");
  const shown = val.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!shown) throw new Error("no aria-hidden visual layer inside .gami-odo-val");
  return Array.from(shown.children)
    .map((el) => {
      if (el.classList.contains("rn-sep")) return el.textContent ?? "";
      const strip = el.querySelector<HTMLElement>(".rn-digit-strip");
      if (!strip) throw new Error("a .rn-digit with no strip");
      const pct = /translateY\((-?\d+)%\)/.exec(strip.style.transform);
      if (!pct) throw new Error(`unreadable transform: ${strip.style.transform}`);
      return String(Number(pct[1]) / -10);
    })
    .join("");
}

/** The plain-text equivalent RollingNumber exposes to assistive tech. */
function srReadout(): string {
  const sr = document.querySelector(".gami-odo-val .sr-only");
  if (!sr) throw new Error("no sr-only readout inside .gami-odo-val");
  return sr.textContent ?? "";
}

function renderCard(careerTotal: number) {
  return render(
    <CareerOdometerCard careerTotal={careerTotal} careerMilestones={[]} weekDelta={0} />,
  );
}

describe("CareerOdometerCard formats hours the way the rest of the app does", () => {
  // The defect. `(0.04).toLocaleString(…maximumFractionDigits: 1)` is "0.0" —
  // a real, documented, nonzero career total printing as if nothing had ever
  // been flagged.
  it("renders a sub-resolution nonzero as <0.1, never a flat 0.0", () => {
    renderCard(0.04);
    expect(visibleReadout()).toBe("<0.1");
    expect(visibleReadout()).not.toBe("0.0");
  });

  it("still renders a true zero as 0.0", () => {
    renderCard(0);
    expect(visibleReadout()).toBe("0.0");
  });

  // Why the card reached for Intl in the first place. A career total is the one
  // hours figure in the app that routinely runs to four digits, and "12345.7"
  // is not a number a human parses at a glance.
  it("still groups thousands", () => {
    renderCard(1234.5);
    expect(visibleReadout()).toBe("1,234.5");
    cleanup();
    renderCard(12345.67);
    expect(visibleReadout()).toBe("12,345.7");
  });

  // Ordinary values must not move — this pins the change to the floor rather
  // than letting any wholesale reformat pass.
  it("leaves every ordinary value exactly where it was", () => {
    for (const [total, expected] of [
      [5.35, "5.4"],
      [5.34, "5.3"],
      [2, "2.0"],
      [41.15, "41.2"],
      [999.94, "999.9"],
    ] as const) {
      cleanup();
      renderCard(total);
      expect(visibleReadout()).toBe(expected);
    }
  });

  // One card, one formatter. The legend's "hrs to the next marker" was already
  // fmtHours; the headline above it must not be answering with a different rule.
  it("uses one formatter for both of the card's hours figures", () => {
    renderCard(0.04);
    expect(visibleReadout()).toBe(fmtHoursGrouped(0.04));
    const legend = document.querySelector(".gami-road-legend")?.textContent ?? "";
    expect(legend).toContain(`${fmtHours(100 - 0.04)} hrs`);
  });
});

describe("CareerOdometerCard survives RollingNumber's digit shredder", () => {
  // A comma and a `<` are both non-digits, so both become .rn-sep spans. The
  // grouped and floored strings are exactly the two shapes that exercise that
  // path, and neither existed on this card before.
  it("splits <0.1 and 1,234.5 into the right strips and separators", () => {
    renderCard(0.04);
    expect(document.querySelectorAll(".rn-digit").length).toBe(2); // 0 and 1
    expect(document.querySelectorAll(".rn-sep").length).toBe(2); // < and .

    cleanup();
    renderCard(1234.5);
    expect(document.querySelectorAll(".rn-digit").length).toBe(5); // 1 2 3 4 5
    expect(document.querySelectorAll(".rn-sep").length).toBe(2); // , and .
  });

  // The whole readout is aria-hidden, so the sr-only span is the only thing a
  // screen reader gets. If the two ever disagree, one of the two audiences is
  // being shown a number that isn't the number.
  it("reads the same to a screen reader as it looks on screen", () => {
    for (const total of [0.04, 0, 2, 5.35, 1234.5, 12345.67]) {
      cleanup();
      renderCard(total);
      expect(srReadout()).toBe(visibleReadout());
      expect(srReadout()).toBe(fmtHoursGrouped(total));
    }
  });

  // The odometer roll is the point of the card. Mount is static by design;
  // the frame after, a changed total rolls its digits.
  it("still rolls when the total changes, and never on mount", async () => {
    const { rerender } = renderCard(1234.5);
    const strips = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".rn-digit-strip"));

    expect(strips().map((el) => el.style.transitionDuration)).toEqual([
      "0ms",
      "0ms",
      "0ms",
      "0ms",
      "0ms",
    ]);

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    rerender(
      <CareerOdometerCard careerTotal={1234.6} careerMilestones={[]} weekDelta={0} />,
    );

    const last = strips()[strips().length - 1];
    expect(last.style.transitionDuration).toBe("450ms");
    expect(last.style.transform).toBe("translateY(-60%)");
    expect(visibleReadout()).toBe("1,234.6");
  });
});
