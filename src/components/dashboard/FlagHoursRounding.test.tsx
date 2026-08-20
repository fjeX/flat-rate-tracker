// @vitest-environment jsdom
//
// Regression cover for `dashboard-flag-hours-rounding`.
//
// The dashboard's big flag-hours readouts formatted themselves. RollingNumber
// took a raw number and ran a bare `value.toFixed(decimals)`, which TRUNCATES
// an x.x5 value — float64 stores 5.35 a hair below 5.35, so toFixed(1) walks
// down to "5.3". Everything else in the app prints hours through fmtHours,
// which rounds half-up first. Same stored number, two answers:
//
//     stored 5.35 -> dashboard tile "5.3h"  vs  the RO row under it "5.4"
//
// That contradiction was visible on ONE screen, because RoList renders on the
// dashboard directly beneath the Today · Flag headline. The sr-only text
// carried the wrong figure too.
//
// These assertions read rendered textContent rather than props: RollingNumber
// splits its text into per-digit strips plus separator spans, so "is the right
// string on screen" is only answerable from the DOM. Each case is paired with a
// control that must NOT move, so a fix that simply rounds everything up cannot
// pass.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { fmtHours } from "@/lib/stats";
import { StatCard } from "./StatCard";
import { TodayCard } from "./TodayCard";
import { RoList } from "@/components/ro/RoList";
import { RollingNumber } from "@/components/ui/RollingNumber";
import type { Entry } from "@/lib/types";

// TodayCard mounts QuickAddModal, which calls useRouter — there is no app
// router outside Next's runtime. Nothing under test navigates.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

// Every value here is expressible in numeric(5,2), so each one is a figure a
// single RO can really store — this is not a float-precision curiosity.
const DIVERGENT = [5.35, 2.15, 41.15];

// Values that already agreed. They pin the fix to the x.x5 boundary instead of
// letting a blanket round-up pass: 5.34 must stay 5.3, and 2 must keep its
// trailing zero.
const CONTROLS = [5.34, 2, 0];

function stats(flagHours: number) {
  return {
    flagHours,
    clockedHours: 8,
    efficiency: null,
    roCount: 1,
    actualHours: 0,
    unpaidHours: 0,
    comebackHours: 0,
    waitingHours: 0,
    shopHours: 0,
    upsellHours: 0,
  };
}

function entry(flagHours: number): Entry {
  return {
    id: "e1",
    userId: "u1",
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    date: "2026-08-20",
    roNumber: "12345",
    vehicle: { year: null, make: "", model: "" },
    opCodes: [],
    flagHours,
    notes: "",
  } as unknown as Entry;
}

/** The tile's headline, digits + unit, as a reader sees it. */
function headline(): string {
  const el = document.querySelector(".stat-value");
  if (!el) throw new Error("no .stat-value rendered");
  // The digit strips render every 0-9 cell, so textContent of the whole node is
  // noise. The plain-text equivalent RollingNumber exposes to AT is the value.
  const sr = el.querySelector(".sr-only");
  if (!sr) throw new Error("no sr-only readout inside .stat-value");
  const unit = el.querySelector(".unit")?.textContent ?? "";
  return `${sr.textContent ?? ""}${unit}`;
}

describe("dashboard flag hours agree with fmtHours", () => {
  for (const v of [...DIVERGENT, ...CONTROLS]) {
    it(`StatCard prints ${fmtHours(v)}h for a stored ${v}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<StatCard label="Pay Period" stats={stats(v) as any} />);
      expect(headline()).toBe(`${fmtHours(v)}h`);
    });

    it(`TodayCard prints ${fmtHours(v)}h for a stored ${v} (quick-add off)`, () => {
      render(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <TodayCard date="2026-08-20" stats={stats(v) as any} initialHours={8} library={[]} />,
      );
      expect(headline()).toBe(`${fmtHours(v)}h`);
    });

    it(`TodayCard prints ${fmtHours(v)}h for a stored ${v} (quick-add on)`, () => {
      render(
        <TodayCard
          date="2026-08-20"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stats={stats(v) as any}
          initialHours={8}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          library={[{ id: "o1", code: "A", description: "", flagHours: 1, subOpCodes: [] } as any]}
        />,
      );
      // Quick add is opt-out, so this branch is what most techs actually see.
      expect(document.querySelector(".today-card button")).toBeTruthy();
      expect(headline()).toBe(`${fmtHours(v)}h`);
    });
  }

  // The user-visible contract, and the shape the escalation was filed as: the
  // Today · Flag headline and the RO row beneath it are the same period's same
  // hours, rendered on the same screen.
  it("the dashboard headline and the RO row under it show the same figure", () => {
    render(
      <div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <TodayCard date="2026-08-20" stats={stats(5.35) as any} initialHours={8} library={[]} />
        <RoList entries={[entry(5.35)]} />
      </div>,
    );
    const row = document.querySelector(".hours");
    expect(row).toBeTruthy();
    expect(headline()).toBe(row!.textContent);
  });

  // fmtHours never prints a flat "0.0" for a genuinely nonzero value — that is
  // the bug lib/format.ts was created to end. A formatter of its own inside
  // RollingNumber would have reintroduced it here even with half-up rounding.
  it("a sub-resolution nonzero renders as <0.1, not 0.0", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<StatCard label="Pay Period" stats={stats(0.04) as any} />);
    expect(headline()).toBe("<0.1h");
  });
});

describe("RollingNumber", () => {
  // It renders text; it does not decide what the text says. Given an already
  // formatted string it must reproduce it character for character, including
  // the non-digit ones, so no caller's formatter is silently reinterpreted.
  it("reproduces the string it is handed, verbatim", () => {
    for (const s of ["5.4", "2.0", "<0.1", "-<0.1", "01:23:45", "1,234.5"]) {
      cleanup();
      render(<RollingNumber value={s} />);
      expect(screen.getByText(s, { selector: ".sr-only" }).textContent).toBe(s);
    }
  });

  // The roll is per-digit and driven by the rendered text, so a string value
  // animates exactly like a numeric one used to — the number path only ever
  // produced the same string a step earlier. This pins that: every digit still
  // gets a strip, every non-digit still gets a separator.
  it("still builds a digit strip per digit for a string value", () => {
    render(<RollingNumber value="<0.1" />);
    expect(document.querySelectorAll(".rn-digit").length).toBe(2); // 0 and 1
    expect(document.querySelectorAll(".rn-sep").length).toBe(2); // < and .
    expect(document.querySelectorAll(".rn-digit-strip").length).toBe(2);
  });

  // Motion is a deliberate part of this component, so removing the number prop
  // must not have quietly turned the dashboard's tiles static. Mount paints
  // with transitions off; the frame after, a changed value rolls.
  it("still rolls the changed digit when a string value updates", async () => {
    const { rerender } = render(<RollingNumber value="5.3" />);
    const strips = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".rn-digit-strip"));

    // First paint is static by design — otherwise every tile spins on load.
    expect(strips().map((el) => el.style.transitionDuration)).toEqual(["0ms", "0ms"]);
    expect(strips()[1].style.transform).toBe("translateY(-30%)");

    // Let the mount rAF land, then change the value the way a save does.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    rerender(<RollingNumber value="5.4" />);

    expect(strips()[1].style.transitionDuration).toBe("450ms");
    expect(strips()[1].style.transform).toBe("translateY(-40%)");
  });
});
