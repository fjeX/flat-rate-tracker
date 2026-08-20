// @vitest-environment jsdom
//
// Regression cover for `zero-efficiency-hero-copy`.
//
// The in-progress hero rendered this, as ONE sentence, on 2026-08-18:
//
//     0% efficiency · well ahead of your goal so far
//
// Two clauses from two pipelines that never consult each other. `efficiency` is
// gated per day by pairDay(), so 42.0h sitting on an unscheduled Saturday and a
// still-in-progress today fell out of the numerator entirely; the forecast next
// to it is built from the raw flagged total, so it still saw all 42.0h. Both
// halves computed correctly. Together they told the tech he had produced
// nothing and was well ahead.
//
// It self-resolved the next morning, which is exactly why it needs a test: the
// state is transient and guaranteed to return on the 1st and 16th of every
// month, when most of a period's flagged work is still on open days.
//
// WHY THIS DRIVES THE COMPONENT AND NOT JUST THE PREDICATE:
// lib/efficiency-display has its own unit tests, and they cannot fail on this
// bug — the defect was never in a calculation. It was two correct values
// rendered into one sentence. Only the rendered output can prove they are no
// longer in it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { PeriodHero } from "./PeriodHero";
import type { ProjectionLabel } from "@/lib/period-mode";

// The awaiting-pay hero writes through this server action. The mock records the
// exact call ORDER — which is the whole point for the second suite below, where
// the defect is "how many writes", not "what value" — and keeps jsdom from
// evaluating server-only code for the first.
const calls: string[] = [];
/** What the next save answers with. `null` = success. */
let nextError: string | null = null;

/** Result of one save, once someone decides it. */
type SaveResult = { error?: string };

// DEFERRED MODE. Two of the defects below are about ORDERING — an older save
// landing after a newer one — and that is unreachable while every call resolves
// immediately in the order it was made. With `deferMode` on, each call parks its
// resolver here and the test decides who finishes, and in what order.
let deferMode = false;
const pending: ((r: SaveResult) => void)[] = [];
/** Finish the Nth save (0-based, in call order) with `result`. */
function settle(nth: number, result: SaveResult) {
  const resolve = pending[nth];
  if (!resolve) throw new Error(`no pending save #${nth}`);
  resolve(result);
}

const setPaidPeriodHoursAction = vi.fn(
  async (periodKey: string, hours: number): Promise<SaveResult> => {
    calls.push(`upsert:${periodKey}:${hours}`);
    if (deferMode) return new Promise<SaveResult>((r) => pending.push(r));
    return nextError === null ? {} : { error: nextError };
  },
);

vi.mock("@/app/actions/paid-periods", () => ({
  setPaidPeriodHoursAction: (...a: [string, number]) =>
    setPaidPeriodHoursAction(...a),
}));

/** The forecast state that produced the contradiction: early, wildly ahead. */
const AHEAD_TOO_EARLY: ProjectionLabel = { kind: "implausible", state: "ahead" };

// Explicit rather than leaning on auto-cleanup: several assertions below read
// document.body wholesale, and a leaked render from the previous test would make
// a "must not appear" assertion fail for the wrong reason.
afterEach(cleanup);

// ONE locator, used by both the "must not appear" and the "must appear" case.
// A negative assertion on a selector nothing ever matches passes for free — the
// control below is what proves this regex can find a percentage at all.
const EFFICIENCY_FIGURE = /\d+% efficiency/;

function support(): HTMLElement {
  const el = document.querySelector(".period-hero-support");
  if (!el) throw new Error("hero has no support line");
  return el as HTMLElement;
}

describe("InProgressHero — a percentage that means nothing is withheld", () => {
  it("never claims 0% and 'well ahead' in the same breath", () => {
    render(
      <PeriodHero.InProgress
        flagHours={42}
        // A genuinely computed 0: numerator 0 over a real denominator, because
        // every flagged hour landed on a day with no measurable length.
        efficiency={0}
        unpairedFlagHours={42}
        unpairedDays={2}
        projection={AHEAD_TOO_EARLY}
      />,
    );

    // The projection is NOT censored — it answers a different question and it
    // is true.
    expect(screen.getByText(/well ahead of your goal so far/)).toBeTruthy();

    // The percentage is gone from the whole hero, not merely moved.
    expect(document.body.textContent).not.toMatch(EFFICIENCY_FIGURE);
    expect(document.body.textContent).not.toMatch(/0%/);

    // And "in the same breath" is pinned structurally, not just by wording:
    // whatever the hero says about efficiency is not on the projection's line.
    expect(support().textContent).not.toMatch(/efficiency/i);

    // Withheld out loud, naming the hours and the day count.
    const note = screen.getByText(/No efficiency yet/);
    expect(note.textContent).toMatch(/42\.0h/);
    expect(note.textContent).toMatch(/2 days/);
  });

  it("says which figure is missing when most — not all — of the work is excluded", () => {
    render(
      <PeriodHero.InProgress
        flagHours={40}
        // 4h over an 8h day = a real 50%, but it describes a tenth of the work.
        efficiency={50}
        unpairedFlagHours={36}
        unpairedDays={1}
        projection={AHEAD_TOO_EARLY}
      />,
    );

    expect(document.body.textContent).not.toMatch(EFFICIENCY_FIGURE);
    const note = screen.getByText(/Efficiency isn't shown/);
    expect(note.textContent).toMatch(/36\.0h/);
    expect(note.textContent).toMatch(/of the 40\.0h/);
    expect(note.textContent).toMatch(/a day/);
  });
});

describe("InProgressHero — the control: a real 0% still shows", () => {
  // THE CASE THAT PROVES THE PREDICATE ISN'T JUST SWALLOWING ZEROS.
  // A tech who clocked 8 hours and flagged nothing has a true, useful and
  // fairly alarming 0%. Keying the withhold on `efficiency === 0` would have
  // erased it — which is why the predicate keys on excluded hours instead.
  it("prints 0% when the zero is fully measured", () => {
    render(
      <PeriodHero.InProgress
        flagHours={0}
        efficiency={0}
        unpairedFlagHours={0}
        unpairedDays={0}
        projection={{ kind: "projected", projected: 12, goal: 45, state: "behind" }}
      />,
    );

    expect(support().textContent).toMatch(EFFICIENCY_FIGURE);
    expect(screen.getByText(/0% efficiency/)).toBeTruthy();
    expect(screen.queryByText(/No efficiency yet/)).toBeNull();
    expect(screen.queryByText(/Efficiency isn't shown/)).toBeNull();
  });

  // The visual-suite fixture shape: one unscheduled Saturday inside a period of
  // otherwise clocked weekdays. A couple of excluded hours must NOT trip the
  // withhold — if they did, every schedule-aware period with a single odd day
  // would lose its percentage.
  it("keeps the percentage when only a small share of the work is excluded", () => {
    render(
      <PeriodHero.InProgress
        flagHours={30.8}
        efficiency={62}
        unpairedFlagHours={2.8}
        unpairedDays={1}
        projection={{ kind: "projected", projected: 44, goal: 45, state: "close" }}
      />,
    );

    expect(support().textContent).toMatch(EFFICIENCY_FIGURE);
    expect(screen.getByText(/62% efficiency/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Regression cover for `hero-paid-hours-no-blur-save`.
//
// THE BUG: the hero's "Paid flag hours" input had onChange and nothing else.
// The typed figure lived in React state and was committed ONLY by the form's
// submit — the "Check my pay" button, or Enter. Type a figure, click blank
// space, and the number sits there on screen looking saved while nothing was
// written. The sibling field in DiscrepancyCard, which writes this same column
// and looks the same, has always committed on blur. Two identical-looking
// affordances, two different meanings for "click away".
//
// THE HAZARD THE FIX INTRODUCES, and the reason these tests exist at all:
// clicking "Check my pay" blurs the input on the way to the button, so a naive
// onBlur makes the primary path write TWICE. A fix of exactly this shape has
// twice killed the common path in this repo, so the cases below vary the
// PRECONDITION (nothing written yet vs. a figure already written) and not just
// the interaction.
//
// WHY THIS DRIVES THE COMPONENT AND NOT THE ACTION: lib/db/paid-periods and the
// server action are covered and correct — no wrong value is ever computed here.
// The defect is whether a write is issued at all, and how many. Only the
// rendered, focus-managed component can prove that.
describe("AwaitingPayHero — the paid-hours figure commits on blur, exactly once", () => {
  const PERIOD = "2026-08-P1";
  const onSaved = vi.fn();

  beforeEach(() => {
    calls.length = 0;
    nextError = null;
    deferMode = false;
    pending.length = 0;
    // mockReset, not mockClear: one test below installs a THROWING
    // implementation, and a leaked `mockImplementationOnce` would blow up an
    // unrelated test instead of failing this one.
    onSaved.mockReset();
    setPaidPeriodHoursAction.mockClear();
  });

  function setup() {
    render(
      <>
        <PeriodHero.AwaitingPay
          periodKey={PERIOD}
          flagHours={80}
          roCount={12}
          onSaved={onSaved}
        />
        {/* A real focusable "somewhere else", so a blur can carry a
            relatedTarget that is NOT the submit button. */}
        <button type="button">elsewhere</button>
      </>,
    );
  }

  const field = () => screen.getByRole("spinbutton") as HTMLInputElement;
  const checkBtn = () =>
    screen.getByRole("button", { name: /Check my pay/ }) as HTMLButtonElement;
  const form = () => {
    const el = field().closest("form");
    if (!el) throw new Error("hero input is not in a form");
    return el;
  };

  const edit = (value: string) =>
    fireEvent.change(field(), { target: { value } });

  const errorLine = () => document.querySelector(".period-hero-error");

  // WHY THESE TWO HELPERS DO NOT USE fireEvent.submit().
  //
  // `fireEvent.submit(form)` dispatches a submit event directly, which SKIPS
  // HTML constraint validation entirely. Every submit-path test in this suite
  // used to do that, and the consequence was that they passed identically
  // against a component whose button path was completely dead: the input was
  // `step={0.1}`, so any 2-decimal figure — 74.25, the shape half of a real
  // paystub takes — was `stepMismatch: true`, and a real browser refused to
  // submit the form at all. Eleven green tests, zero writes in production.
  //
  // `button.click()` and `form.requestSubmit()` are the two things a browser
  // actually does, and both run constraint validation first. jsdom implements
  // that faithfully: with step={0.1} neither one fires a submit event for
  // 74.25, it fires `invalid` instead.

  /** What a browser does when you click a button while the field has focus:
   *  blur the field (relatedTarget set — or null in Safari and Firefox/macOS),
   *  then deliver the click, whose default action submits the form. */
  async function clickCheck(relatedTarget: HTMLElement | null) {
    await act(async () => {
      fireEvent.blur(field(), { relatedTarget });
      checkBtn().click();
    });
  }

  /** Enter in a text field: implicit submission, with no blur before it. */
  async function pressEnter() {
    await act(async () => {
      form().requestSubmit();
    });
  }

  // --- the bug itself -----------------------------------------------------
  it("saves when the field loses focus to blank space", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves when focus moves to another control entirely", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field(), {
        relatedTarget: screen.getByRole("button", { name: "elsewhere" }),
      });
    });

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
  });

  // --- the common path, which the fix must not double-fire or break -------
  it("clicking 'Check my pay' writes ONCE, not once per blur and once per submit", async () => {
    setup();
    edit("74.2");
    await clickCheck(checkBtn());

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(setPaidPeriodHoursAction).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  // Safari and Firefox/macOS do not focus a clicked button, so relatedTarget is
  // null and a relatedTarget-based guard would let both writes through. The
  // dedupe is on the VALUE precisely so this browser difference cannot matter.
  it("clicking 'Check my pay' still writes ONCE when the blur carries no relatedTarget", async () => {
    setup();
    edit("74.2");
    await clickCheck(null);

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
  });

  it("Enter — a submit with no blur at all — still writes once", async () => {
    setup();
    edit("74.2");
    await pressEnter();

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  // --- preconditions: a figure ALREADY written in this mount --------------
  // The hero only renders while paid_period_hours has no row (lib/period-mode),
  // so "already written" can only mean written since this mount — the window
  // between the save and router.refresh() swapping in the Settled hero.
  it("blurring an unchanged figure a second time does not write again", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    await act(async () => {
      fireEvent.blur(field());
    });

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("correcting the figure after a save writes the new one", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    edit("80.5");
    await act(async () => {
      fireEvent.blur(field());
    });

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`, `upsert:${PERIOD}:80.5`]);
  });

  // --- nothing to write ---------------------------------------------------
  it("blurring an empty field writes nothing and says nothing", async () => {
    setup();
    await act(async () => {
      fireEvent.blur(field());
    });

    expect(calls).toEqual([]);
    // Clicking away from a blank box is not a failed attempt at anything.
    expect(screen.queryByText(/Enter the flag hours/)).toBeNull();
  });

  it("blurring an unparseable field writes nothing and does not throw", async () => {
    setup();
    edit("not a number");
    await act(async () => {
      fireEvent.blur(field());
    });

    expect(calls).toEqual([]);
  });

  // The control for the two negative assertions above: the SAME message and the
  // same empty field, reached by an explicit press, must still appear — so
  // "queryByText(...) is null" above is proving suppression, not a dead
  // selector.
  it("control: pressing 'Check my pay' on an empty field DOES ask for the figure", async () => {
    setup();
    // An empty field is `valid` (nothing is `required`), so this really does
    // reach the submit handler — the assertion below is proving suppression,
    // not proving that constraint validation ate the event.
    expect(field().validity.valid).toBe(true);
    await act(async () => {
      checkBtn().click();
    });

    expect(calls).toEqual([]);
    expect(screen.getByText(/Enter the flag hours/)).toBeTruthy();
  });

  // --- a failed write must not dedupe the retry away ----------------------
  it("after a rejected save, retrying the same figure writes again", async () => {
    setup();
    nextError = "Paid hours can't be more than 200.";
    edit("999");
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(screen.getByText("Paid hours can't be more than 200.")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();

    nextError = null;
    await act(async () => {
      checkBtn().click();
    });

    expect(calls).toEqual([`upsert:${PERIOD}:999`, `upsert:${PERIOD}:999`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  // --- DEFECT 4: a real paystub figure has two decimals --------------------
  // `step={0.1}` made 74.25 `stepMismatch: true`, and a browser will not submit
  // an invalid form: the button and Enter were dead for exactly the figures
  // flat-rate stubs are full of (74.25, 8.75). Blur has no validation gate, so
  // once blur-save shipped the two routes DISAGREED — click away and it saved,
  // press the primary button and nothing happened.
  //
  // The ceiling stays where the DB put it: paid_period_hours.paid_flag_hours is
  // numeric(6,2), and `paidPeriodSchema` already enforces 0 … 9999.99 with a
  // sentence the tech can read. `step="any"` widens the input to exactly the
  // precision that column stores. No `max` attribute is added on purpose — the
  // server owns that message, and a browser tooltip on one route plus a server
  // sentence on the other would rebuild the same split this test closes.
  describe("a 2-decimal figure — the shape half of a real paystub takes", () => {
    it("is accepted by the input's own constraint validation", () => {
      setup();
      edit("74.25");
      expect(field().validity.stepMismatch).toBe(false);
      expect(field().validity.valid).toBe(true);
    });

    // The click ALONE, with no blur in front of it. Driving this through
    // `clickCheck` would prove nothing: the blur saves first and the assertion
    // passes on a component whose button is still refusing to submit.
    it("saves from the 'Check my pay' button", async () => {
      setup();
      edit("74.25");
      await act(async () => {
        checkBtn().click();
      });

      expect(calls).toEqual([`upsert:${PERIOD}:74.25`]);
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("the ordinary blur-then-click still writes it exactly once", async () => {
      setup();
      edit("74.25");
      await clickCheck(checkBtn());

      expect(calls).toEqual([`upsert:${PERIOD}:74.25`]);
      expect(setPaidPeriodHoursAction).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("saves from Enter", async () => {
      setup();
      edit("74.25");
      await pressEnter();

      expect(calls).toEqual([`upsert:${PERIOD}:74.25`]);
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("saves on blur", async () => {
      setup();
      edit("74.25");
      await act(async () => {
        fireEvent.blur(field());
      });

      expect(calls).toEqual([`upsert:${PERIOD}:74.25`]);
    });

    // The full-precision case the column can hold: 8.75 is the other shape a
    // stub takes, and it must not need a different route than 74.25.
    it("saves a small 2-decimal figure the same way", async () => {
      setup();
      edit("8.75");
      await clickCheck(checkBtn());

      expect(calls).toEqual([`upsert:${PERIOD}:8.75`]);
    });
  });

  // --- DEFECT 1: an explicit press is never a no-op ------------------------
  // The value-dedupe that stops blur+click double-writing also caught the
  // SECOND deliberate press of the primary button and returned in total
  // silence: no write, no onSaved, no error, button still enabled. During the
  // router.refresh() window — which is the entire lifetime of this hero after
  // a save — the tech's call to action did nothing at all.
  it("pressing 'Check my pay' after a blur-save advances the UI instead of doing nothing", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(onSaved).toHaveBeenCalledTimes(1);

    await act(async () => {
      checkBtn().click();
    });

    // The redundant WRITE is still skipped — that is the part worth keeping.
    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    // But the press is answered.
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(errorLine()).toBeNull();
  });

  it("...and it answers every press, without ever writing again", async () => {
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    await act(async () => {
      checkBtn().click();
    });
    await act(async () => {
      checkBtn().click();
    });

    // One press, one refresh — bounded by the tech's finger, never self-driven.
    expect(onSaved).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
  });

  // THE GUARD ON THAT FIX. "Already claimed" and "already written" are not the
  // same state. Answering an explicit press during the in-flight window would
  // advance the UI for a write that has not landed and may yet fail — and on
  // the ordinary click path the blur claims the value one line before the
  // submit sees it, so keying on the claim alone would fire onSaved twice on
  // every single click.
  it("an explicit press while the write is still in the air does not advance the UI early", async () => {
    deferMode = true;
    setup();
    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    await pressEnter();

    expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      settle(0, {});
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("a failed write leaves the button able to retry it", async () => {
    setup();
    nextError = "Paid hours can't be more than 9999.99.";
    edit("74.25");
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(onSaved).not.toHaveBeenCalled();

    // The un-claim on failure is what makes this a real retry and not an
    // onSaved()-only no-op: the same figure must be WRITTEN again.
    nextError = null;
    await act(async () => {
      checkBtn().click();
    });
    expect(calls).toEqual([`upsert:${PERIOD}:74.25`, `upsert:${PERIOD}:74.25`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  // --- DEFECT 2: a failed refresh is not a failed save ---------------------
  // onSaved() — router.refresh() — sat INSIDE the try. A throwing refresh
  // un-claimed the value and printed "Failed to save" for a row that is sitting
  // in the database, and the next blur then wrote a duplicate.
  it("a refresh that throws is not reported as a failed save", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      onSaved.mockImplementation(() => {
        throw new Error("refresh blew up");
      });
      setup();
      edit("74.2");
      await act(async () => {
        fireEvent.blur(field());
      });

      expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
      // The write SUCCEEDED. Saying otherwise sends the tech to re-enter a
      // figure that is already recorded.
      expect(errorLine()).toBeNull();
      expect(screen.queryByText(/refresh blew up/)).toBeNull();
      expect(screen.queryByText(/Failed to save/)).toBeNull();

      // And it is still claimed, so clicking away again does not duplicate it.
      onSaved.mockImplementation(() => {});
      await act(async () => {
        fireEvent.blur(field());
      });
      expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    } finally {
      consoleError.mockRestore();
    }
  });

  // --- DEFECT 3: a stale failure must not un-claim a newer value -----------
  // `previous` is captured per call, so an OLDER save that fails LATER restored
  // savedRef to ITS previous value — wiping the claim a newer, successful save
  // had made. Reachable because the input is never disabled during a save;
  // only the button is.
  it("an older save failing after a newer one succeeded does not un-claim the newer value", async () => {
    deferMode = true;
    setup();

    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    edit("80");
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(calls).toEqual([`upsert:${PERIOD}:74.2`, `upsert:${PERIOD}:80`]);

    // The NEWER figure lands first, and lands cleanly.
    await act(async () => {
      settle(1, {});
    });
    expect(onSaved).toHaveBeenCalledTimes(1);

    // Then the older one fails. It describes a figure nobody is looking at any
    // more, so it owns neither the claim nor the error line.
    await act(async () => {
      settle(0, { error: "stale failure" });
    });
    expect(screen.queryByText("stale failure")).toBeNull();
    expect(errorLine()).toBeNull();

    // The real proof: 80 is still claimed, so clicking away does not rewrite it.
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(calls).toEqual([`upsert:${PERIOD}:74.2`, `upsert:${PERIOD}:80`]);
  });

  // The control for the test above: the SAME stale-ordering machinery, with the
  // newer save FAILING, must still surface its error and still let the retry
  // through. Without this, "no error appeared" above could be a component that
  // simply stopped reporting failures.
  it("control: when the NEWEST save is the one that fails, it says so and can be retried", async () => {
    deferMode = true;
    setup();

    edit("74.2");
    await act(async () => {
      fireEvent.blur(field());
    });
    edit("80");
    await act(async () => {
      fireEvent.blur(field());
    });

    await act(async () => {
      settle(0, {});
    });
    await act(async () => {
      settle(1, { error: "newest failure" });
    });

    expect(screen.getByText("newest failure")).toBeTruthy();

    deferMode = false;
    nextError = null;
    await act(async () => {
      fireEvent.blur(field());
    });
    expect(calls).toEqual([
      `upsert:${PERIOD}:74.2`,
      `upsert:${PERIOD}:80`,
      `upsert:${PERIOD}:80`,
    ]);
  });

  // --- DEFECTS 1, 2, 5 and 7: the CTA that answers nothing -----------------
  //
  // One bug seen from four sides. `writtenRef` was recorded only when the call
  // that landed was still the newest one ISSUED, so a success that arrived
  // "late" was discarded — including the one fact it carried, that its row is
  // in the database. The failure that followed then restored the claim to
  // exactly that value, and the component was left holding a claim with
  // nothing under it: `savedRef` said 74.2, `writtenRef` said nothing had ever
  // been written, and both of the button's outcomes were gated behind one of
  // them.
  //
  // Observed, three presses in a row, from the tech's own console:
  //   {"calls":["74.2","742000"],"saved":0,
  //    "error":"Paid hours can't be more than 9999.99.","btnDisabled":false}
  // No write, no refresh, no change of message, button enabled — parked under
  // an error describing a figure that is not in the field, with the correct
  // number already in the database. The only escape was typing a DIFFERENT
  // number, which is the one thing a tech reading "can't be more than 9999.99"
  // will not do.
  //
  // WHY THESE ARE ORDERING TESTS AND NOT VALUE TESTS: nothing here computes a
  // wrong figure. Every one of these states is reachable only because the
  // INPUT is never disabled during a save — only the button is — so the tech
  // can put a second write in the air before the first one answers. Remove
  // `deferMode` and every case below becomes unreachable and green for free.
  describe("an explicit press is answered, whatever order the saves came back in", () => {
    const TOO_BIG = "Paid hours can't be more than 9999.99.";

    async function blurField() {
      await act(async () => {
        fireEvent.blur(field());
      });
    }

    /** The submit button located STRUCTURALLY, not by its label. While a write
     *  is in the air the button reads "Checking…", so the name-based locator
     *  cannot find the very element whose disabled state is under test — and a
     *  locator that throws is not evidence that the button was disabled. */
    const submitBtn = () =>
      form().querySelector("button[type=submit]") as HTMLButtonElement;

    it("D1: after a stale success and a newer rejection, the button still answers", async () => {
      deferMode = true;
      setup();

      edit("74.2");
      await blurField();
      // The input is live during the flight, so a second figure goes in the air
      // behind the first — a fat-fingered one, which is how the tech got here.
      edit("742000");
      await blurField();
      expect(calls).toEqual([
        `upsert:${PERIOD}:74.2`,
        `upsert:${PERIOD}:742000`,
      ]);

      // 74.2 LANDS. It is in the database from this line onward, and no
      // question about which call was issued first changes that.
      await act(async () => {
        settle(0, {});
      });
      // Then the newer one is rejected and un-claims itself back to 74.2.
      await act(async () => {
        settle(1, { error: TOO_BIG });
      });
      expect(screen.getByText(TOO_BIG)).toBeTruthy();

      // The tech reads the error, retypes the figure he meant, and presses the
      // primary button.
      deferMode = false;
      nextError = null;
      edit("74.2");
      await act(async () => {
        checkBtn().click();
      });

      // ANSWERED. The figure asked for is the figure the database holds, so the
      // press gets the refresh it was pressed for.
      expect(onSaved).toHaveBeenCalledTimes(1);
      // And the rejection it advanced out from under is gone, rather than
      // sitting over a field that no longer contains the rejected number.
      expect(errorLine()).toBeNull();
      // The redundant WRITE is still skipped — that part was never wrong.
      expect(calls).toEqual([
        `upsert:${PERIOD}:74.2`,
        `upsert:${PERIOD}:742000`,
      ]);
      expect(checkBtn().disabled).toBe(false);
    });

    it("D2: the page does not advance while the newest figure's rejection is on screen", async () => {
      deferMode = true;
      setup();
      edit("74.2");
      await blurField();
      edit("742000");
      await blurField();

      // The NEWER save is rejected first...
      await act(async () => {
        settle(1, { error: TOO_BIG });
      });
      // ...and the older one succeeds after it.
      await act(async () => {
        settle(0, {});
      });

      // Nothing is lost here — 74.2 really is recorded — but the screen must
      // not say two things at once. "742000 is too big" is on the line, 742000
      // is still in the box, and repainting the page as settled on 74.2
      // underneath that sentence is the UI contradicting itself out loud.
      expect(screen.getByText(TOO_BIG)).toBeTruthy();
      expect(field().value).toBe("742000");
      expect(onSaved).not.toHaveBeenCalled();
    });

    // Only the newest ISSUED call owns the error line — and "newest" cannot be
    // read off `savedRef`, because `savedRef` is the thing the failure path
    // MUTATES. Once a newer failure restores the claim to the older call's
    // value, an older failure arriving after it matches that claim again and
    // un-claims a figure it has no business touching, replacing a message about
    // what IS in the box with a message about what is not.
    it("an older failure arriving last does not take over the error line", async () => {
      deferMode = true;
      setup();
      edit("74.2");
      await blurField();
      edit("742000");
      await blurField();

      // The newer figure is rejected first: this message describes 742000, and
      // 742000 is what the tech is looking at.
      await act(async () => {
        settle(1, { error: TOO_BIG });
      });
      // Then the older call fails too, for its own unrelated reason.
      await act(async () => {
        settle(0, { error: "network hiccup" });
      });

      expect(screen.getByText(TOO_BIG)).toBeTruthy();
      expect(screen.queryByText("network hiccup")).toBeNull();
    });

    it("D5: when an older write lands last, the next press re-issues the figure on screen", async () => {
      deferMode = true;
      setup();
      edit("74.2");
      await blurField();
      edit("80");
      await blurField();

      // The newer figure lands first, and the hero answers for it.
      await act(async () => {
        settle(1, {});
      });
      expect(onSaved).toHaveBeenCalledTimes(1);
      // Then the OLDER upsert arrives. Last writer wins in Postgres, so the row
      // now holds 74.2 while the field, the claim and the page all say 80.
      await act(async () => {
        settle(0, {});
      });

      // The tech presses the button on the figure he can actually see.
      deferMode = false;
      nextError = null;
      await act(async () => {
        checkBtn().click();
      });

      // It is written again, so the database ends on the figure the UI is
      // reporting rather than on whichever answer happened to arrive last.
      expect(calls).toEqual([
        `upsert:${PERIOD}:74.2`,
        `upsert:${PERIOD}:80`,
        `upsert:${PERIOD}:80`,
      ]);
      expect(onSaved).toHaveBeenCalledTimes(2);
    });

    // THE GUARD ON THE RE-ISSUE ABOVE. "Claimed but not landed" is also the
    // state every ordinary click passes through — the blur claims the value one
    // line before the submit sees it — so re-issuing on that would double-write
    // the primary path, which is the regression this component has shipped
    // twice. The in-flight window is answered by the disabled "Checking…"
    // button, never by a second write.
    it("control: a press while the write is still in the air writes nothing and advances nothing", async () => {
      deferMode = true;
      setup();
      edit("74.2");
      await blurField();

      expect(submitBtn().disabled).toBe(true);
      expect(submitBtn().textContent).toContain("Checking");
      await act(async () => {
        submitBtn().click();
      });
      await act(async () => {
        form().requestSubmit();
      });

      expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
      expect(onSaved).not.toHaveBeenCalled();

      // And it is answered the moment the write lands — once.
      await act(async () => {
        settle(0, {});
      });
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);
    });

    it("D7: retyping the figure already in the database clears the stale rejection", async () => {
      setup();
      edit("74.2");
      await blurField();
      expect(calls).toEqual([`upsert:${PERIOD}:74.2`]);

      nextError = TOO_BIG;
      edit("742000");
      await blurField();
      expect(screen.getByText(TOO_BIG)).toBeTruthy();

      // Correcting the field back. The sentence on screen now describes a
      // number that is not in the box and cannot be re-entered from it.
      nextError = null;
      edit("74.2");
      await blurField();

      expect(errorLine()).toBeNull();
      // Clearing the message is not a licence to write again.
      expect(calls).toEqual([
        `upsert:${PERIOD}:74.2`,
        `upsert:${PERIOD}:742000`,
      ]);
    });
  });

  // --- the `min` split: one figure, two different answers ------------------
  // `min={0}` was a rule on the BUTTON's route only. Constraint validation runs
  // on click and on Enter and does not run on blur, so "-5" met a browser
  // tooltip from the button and vanished in complete silence when the tech
  // clicked away — the exact split `step="any"` was added to close, rebuilt one
  // attribute over. parseHours() already rejects negatives, so the floor was
  // never load-bearing; only the disagreement was.
  describe("a figure the app cannot use gets the same answer on both routes", () => {
    it("is not blocked by the input's own constraint validation", () => {
      setup();
      edit("-5");
      expect(field().validity.rangeUnderflow).toBe(false);
      expect(field().validity.valid).toBe(true);
    });

    it("the button path answers in the app's own sentence", async () => {
      setup();
      edit("-5");
      await act(async () => {
        checkBtn().click();
      });

      expect(calls).toEqual([]);
      expect(screen.getByText(/Enter the flag hours/)).toBeTruthy();
    });

    it("the blur path stays quiet — clicking away is not a failed attempt", async () => {
      setup();
      edit("-5");
      await act(async () => {
        fireEvent.blur(field());
      });

      expect(calls).toEqual([]);
      expect(errorLine()).toBeNull();
    });

    // THE CONTROL. "-5" has to behave identically to text the field could never
    // have taken; the two answers above are only meaningful next to the same
    // two answers here.
    it("control: an unparseable entry takes both routes to those same two answers", async () => {
      setup();
      edit("not a number");
      await act(async () => {
        fireEvent.blur(field());
      });
      expect(calls).toEqual([]);
      expect(errorLine()).toBeNull();

      await act(async () => {
        checkBtn().click();
      });
      expect(calls).toEqual([]);
      expect(screen.getByText(/Enter the flag hours/)).toBeTruthy();
    });

    // The input is deliberately WIDER than the column it feeds: `step="any"`
    // admits 74.256 and numeric(6,2) rounds it to 74.26 on the way in. Pinned
    // because the comment on the input says so — narrowing to step="0.01"
    // would trade a rounded figure for a button that is dead on precisely the
    // entries blur would have saved.
    it("accepts more precision than the column holds, and sends it as typed", async () => {
      setup();
      edit("74.256");
      expect(field().validity.valid).toBe(true);
      await clickCheck(checkBtn());

      expect(calls).toEqual([`upsert:${PERIOD}:74.256`]);
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });
});
