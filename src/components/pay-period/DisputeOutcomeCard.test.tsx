// @vitest-environment jsdom
//
// Cover for the second-round offer sentence — the one place in the card where
// the copy has to agree with a COUNT it doesn't display.
//
// The sentence is assembled from several expressions inside one <p>, and it
// shipped disagreeing with itself, singular and plural eleven words apart:
//
//   "Your earlier CLAIM for Jul 16 – Jul 31 IS closed and you're still short
//    12.5h · 71.1h already recovered ACROSS 2 CLOSED CLAIMS. You can raise a
//    second-round claim for what's left."
//
// WHY THIS ASSERTS ON textContent AND NOT ON THE JSX:
// nothing else can. tsc, lint and the visual gate all pass on a sentence whose
// number agreement is wrong, and JSX silently eats the leading space after an
// expression container (memory/reference_frt_jsx_whitespace.md) — "claimfor",
// "12.5h·". Only the rendered string shows either defect, so every case below
// is an exact inline snapshot of the whole sentence, punctuation included.
//
// THE FOUR STATES, and why the denied one matters:
// the leading clause is gated on `closedForPeriod` while the trailing one is
// gated on `recoveredHere > 0`, so a denied round (closed, recovered 0.0h)
// renders the first half and not the second. Both halves branch on the SAME
// `closedRounds` count, and the sentence has to close cleanly with no orphaned
// middot when the second half disappears.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { DisputeOutcomeCard } from "./DisputeOutcomeCard";
import type { Dispute, DisputeLine, Entry, EntryOpCode } from "@/lib/types";

// Server actions: the module is "use server" and pulls the db client. Nothing
// here taps a button, so a stub is enough to keep jsdom out of server code.
vi.mock("@/app/actions/disputes", () => ({
  applyDisputeRecoveryAction: vi.fn(),
  openDisputeAction: vi.fn(),
  recordDisputeOutcomeAction: vi.fn(),
  setDisputeStatusAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: React.ComponentProps<"a">) => (
    <a {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

const PERIOD_KEY = "2026-07-P2";
const PERIOD_LABEL = "Jul 16 – Jul 31";

/** A closed (resolved) claim on the viewed period that recovered `recovered`. */
function closedRound(id: string, recovered: number): Dispute {
  return {
    id,
    userId: "u1",
    periodKey: PERIOD_KEY,
    periodLabel: PERIOD_LABEL,
    scope: "period",
    status: "resolved",
    claimedHours: 30,
    claimedDollars: null,
    recoveredHours: recovered,
    recoveredDollars: null,
    generatedAt: "2026-08-01T00:00:00Z",
    submittedAt: "2026-08-01T00:00:00Z",
    answeredAt: "2026-08-02T00:00:00Z",
    resolvedAt: "2026-08-02T00:00:00Z",
    note: "",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    lines: [],
  };
}

/**
 * The offer sentence as the tech reads it.
 *
 * ONE locator, used by every case including the ones asserting a clause is
 * ABSENT — a negative assertion written against a selector that matches nothing
 * passes for free (memory/feedback_negative_assertions_go_vacuous.md). Every
 * case here is a positive exact-string match on the same node, so a broken
 * locator fails loudly instead of quietly agreeing.
 */
function offerSentence(container: HTMLElement): string {
  const hits = Array.from(container.querySelectorAll("p")).filter((p) =>
    (p.textContent ?? "").includes("You can raise a second-round claim"),
  );
  expect(hits).toHaveLength(1);
  return hits[0].textContent ?? "";
}

function renderOffer(allDisputes: Dispute[]) {
  const { container } = render(
    <DisputeOutcomeCard
      periodKey={PERIOD_KEY}
      periodLabel={PERIOD_LABEL}
      // No LIVE claim — that is what puts the second-round offer on screen.
      openDispute={null}
      allDisputes={allDisputes}
      entries={[]}
      library={[]}
      shortedHours={12.5}
      pendingCount={0}
      pendingHours={0}
      periodEnded
    />,
  );
  return offerSentence(container);
}

describe("DisputeOutcomeCard second-round offer sentence", () => {
  it("is singular throughout for one closed round", () => {
    expect(renderOffer([closedRound("d1", 19.7)])).toMatchInlineSnapshot(
      `"Your earlier claim for Jul 16 – Jul 31 is closed and you're still short 12.5h · 19.7h already recovered on that closed claim. You can raise a second-round claim for what's left."`,
    );
  });

  it("is plural throughout for two closed rounds", () => {
    expect(
      renderOffer([closedRound("d1", 19.7), closedRound("d2", 51.4)]),
    ).toMatchInlineSnapshot(
      `"Your earlier claims for Jul 16 – Jul 31 are closed and you're still short 12.5h · 71.1h already recovered across 2 closed claims. You can raise a second-round claim for what's left."`,
    );
  });

  it("counts every closed round, not just the last two", () => {
    expect(
      renderOffer([
        closedRound("d1", 19.7),
        closedRound("d2", 51.4),
        closedRound("d3", 4.0),
      ]),
    ).toMatchInlineSnapshot(
      `"Your earlier claims for Jul 16 – Jul 31 are closed and you're still short 12.5h · 75.1h already recovered across 3 closed claims. You can raise a second-round claim for what's left."`,
    );
  });

  it("stays singular and drops the recovery clause for a denied round", () => {
    // Closed with 0.0h back. The leading clause still renders; the trailing one
    // must vanish WITH its middot, leaving "…short 12.5h." not "…short 12.5h ·."
    expect(renderOffer([closedRound("d1", 0)])).toMatchInlineSnapshot(
      `"Your earlier claim for Jul 16 – Jul 31 is closed and you're still short 12.5h. You can raise a second-round claim for what's left."`,
    );
  });

  it("pluralises on the round COUNT even when nothing was recovered", () => {
    // Two denied rounds: `recoveredHere` is 0 so the trailing clause is gone,
    // but there really were two claims — the leading clause is the only thing
    // that can say so, and it must not fall back to the singular.
    expect(
      renderOffer([closedRound("d1", 0), closedRound("d2", 0)]),
    ).toMatchInlineSnapshot(
      `"Your earlier claims for Jul 16 – Jul 31 are closed and you're still short 12.5h. You can raise a second-round claim for what's left."`,
    );
  });

  it("has no glued tokens anywhere in the sentence", () => {
    // The specific failure mode of a sentence built from expression containers:
    // JSX drops the leading space of text that follows one, and every gate in
    // the repo is blind to it. Checked against the plural + recovery case,
    // which crosses the most expression boundaries.
    const sentence = renderOffer([
      closedRound("d1", 19.7),
      closedRound("d2", 51.4),
    ]);
    for (const glued of [
      "claimfor",
      "claimsfor",
      PERIOD_LABEL + "are",
      PERIOD_LABEL + "is",
      "areclosed",
      "isclosed",
      "short12.5h",
      "12.5h·",
      "·71.1h",
      "recoveredacross",
      "claimsacross",
    ]) {
      expect(sentence).not.toContain(glued);
    }
    // Control for the loop above: the same style of check on a pair that IS
    // glued in the real string, proving `not.toContain` here can fail at all.
    expect(sentence).toContain("12.5h ·");
  });
});

// A claim closed as Denied used to be permanently uncorrectable: the form was
// gated on `!isClosed`, and so was the entire button row that could open it, so
// once closed no control existed that could set `recording`. Shops answer in
// stages and techs mis-tap, and the money record was then wrong forever.
describe("DisputeOutcomeCard correcting a closed claim", () => {
  function renderClosed(recovered: number) {
    return render(
      <DisputeOutcomeCard
        periodKey={PERIOD_KEY}
        periodLabel={PERIOD_LABEL}
        openDispute={null}
        allDisputes={[closedRound("d1", recovered)]}
        entries={[]}
        library={[]}
        shortedHours={12.5}
        pendingCount={0}
        pendingHours={0}
        periodEnded
      />,
    );
  }

  it("offers a correction control on a closed claim, not the first-time one", () => {
    renderClosed(0);
    expect(
      screen.getByRole("button", { name: "Correct outcome" }),
    ).toBeTruthy();
    // The first-time idiom and the lifecycle taps belong to a LIVE claim only —
    // a closed claim is off the queue and must not offer to advance or drop.
    expect(screen.queryByRole("button", { name: "Record outcome" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drop it" })).toBeNull();
  });

  it("seeds a DENIED claim's form with 0, not with the ask", () => {
    // The whole point. `closedRound` claimed 30h and recovered 0h. OutcomeForm
    // seeds off `resolvedAt !== null` rather than truthiness precisely so that
    // recovered 0 — a real answer, "they denied it" — survives the round trip.
    // `recoveredHours || claimedHours` would put 30 back in this box and one tap
    // on Save would rewrite a denial as a full payout.
    renderClosed(0);
    fireEvent.click(screen.getByRole("button", { name: "Correct outcome" }));

    const hours = screen.getByLabelText("Recovered hours") as HTMLInputElement;
    expect(hours.value).toBe("0");
    // recoveredDollars is null on this fixture: "we don't know what that was
    // worth" must come back blank, never as $0.
    const dollars = screen.getByLabelText(
      "Recovered dollars",
    ) as HTMLInputElement;
    expect(dollars.value).toBe("");
  });

  it("seeds a partly-paid claim with what was actually recovered", () => {
    // Control for the case above: proves the 0 is read from recoveredHours and
    // is not just an empty/falsy box rendering as "0" by accident.
    renderClosed(19.7);
    fireEvent.click(screen.getByRole("button", { name: "Correct outcome" }));
    const hours = screen.getByLabelText("Recovered hours") as HTMLInputElement;
    expect(hours.value).toBe("19.7");
  });
});

// ---------------------------------------------------------------------------
// "Money came back and none of it can be applied" — the silent states
// ---------------------------------------------------------------------------
//
// pendingRecoveryApplication can hand the card rows [] with unmappedHours > 0
// and needsLineBreakdown false, and the card used to say NOTHING in that state:
// the explanation paragraph lived inside the `rows.length > 0` panel, and the
// only other paragraph was gated on needsLineBreakdown. The tech saw a Recovered
// tile with a real number, a re-offer sentence still calling the period short,
// and no sentence anywhere saying why or what to do next.
//
// There are two ways in and they need DIFFERENT words:
//  A. a claim WITH lines whose lines no longer resolve (deleted RO, renamed op
//     code) or that settled above the ask — goodwill / deleted RO.
//  B. a claim with NO lines — the period-total claim, which is the normal shape
//     of a non-itemized ask, not a fault. Calling it goodwill or a deleted RO
//     would be false.
//
// EVERY case below asserts the SAME three locators as one object, including the
// zeros. A negative assertion written against a selector that matches nothing
// passes for free (memory/feedback_negative_assertions_go_vacuous.md); asserting
// the whole triple means a broken locator reads {0,0,0} and fails loudly in the
// cases that expect a 1.
function disputeLine(over: Partial<DisputeLine> = {}): DisputeLine {
  return {
    id: "dl1",
    disputeId: "d1",
    entryId: "e1",
    lineId: null,
    roNumber: "1001",
    code: "BRK-F",
    description: "Front brakes",
    workDate: "2026-07-20",
    flaggedHours: 1.5,
    paidHours: 1,
    claimedHours: 0.5,
    claimedDollars: null,
    recoveredHours: 0,
    recoveredDollars: null,
    hadPhoto: false,
    position: 0,
    ...over,
  };
}

function liveLine(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "l1",
    opCodeId: null,
    custom: true,
    customCode: "BRK-F",
    customDescription: "Front brakes",
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: 1,
    ...over,
  };
}

function liveRO(lines: EntryOpCode[]): Entry {
  return {
    id: "e1",
    userId: "u1",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-20",
    roNumber: "1001",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
  };
}

/** An itemized closed claim — `closedRound` is the period-total shape. */
function itemizedRound(
  recovered: number,
  lines: DisputeLine[],
  claimed = 3,
): Dispute {
  return {
    ...closedRound("d1", recovered),
    scope: "lines",
    claimedHours: claimed,
    lines,
  };
}

/** How many paragraphs of each kind the card rendered. */
function noteCounts(container: HTMLElement) {
  const paras = Array.from(container.querySelectorAll("p")).map(
    (p) => p.textContent ?? "",
  );
  const count = (needle: string) =>
    paras.filter((t) => t.includes(needle)).length;
  return {
    goodwill: count("couldn't be matched to a line automatically"),
    periodTotal: count("raised for the period total"),
    breakdown: count("recorded against individual lines"),
  };
}

function renderCard(over: {
  allDisputes: Dispute[];
  entries?: Entry[];
  shortedHours?: number;
}) {
  const { container } = render(
    <DisputeOutcomeCard
      periodKey={PERIOD_KEY}
      periodLabel={PERIOD_LABEL}
      openDispute={null}
      allDisputes={over.allDisputes}
      entries={over.entries ?? []}
      library={[]}
      shortedHours={over.shortedHours ?? 12.5}
      pendingCount={0}
      pendingHours={0}
      periodEnded
    />,
  );
  return container;
}

describe("DisputeOutcomeCard unmapped-recovery explanations", () => {
  it("explains a claim whose lines no longer exist, with no rows to show", () => {
    // Case A at its emptiest: the claim named one line, the RO is gone, so
    // nothing maps and there is no Apply panel for the footnote to live under.
    // This is the state that rendered a bare Recovered tile and nothing else.
    const container = renderCard({
      allDisputes: [
        itemizedRound(0.5, [
          disputeLine({ entryId: "gone", roNumber: "9999", recoveredHours: 0.5 }),
        ]),
      ],
      entries: [liveRO([liveLine()])],
    });
    expect(noteCounts(container)).toEqual({
      goodwill: 1,
      periodTotal: 0,
      breakdown: 0,
    });
    // No rows means no offer to apply anything — the paragraph is the whole
    // story, so a stray Apply button here would promise a write that has no
    // rows behind it.
    expect(screen.queryByRole("button", { name: /^Apply / })).toBeNull();
  });

  it("explains the leftover once, not twice, when some of it DID map", () => {
    // Case A with a live panel: one line resolves and one doesn't. The footnote
    // belongs under the rows it qualifies and must not also render standalone —
    // two paragraphs about the same 0.5h is the failure mode of gating the
    // standalone copy on `unmappedHours > 0` alone.
    const container = renderCard({
      allDisputes: [
        itemizedRound(1, [
          disputeLine({ id: "a", entryId: "e1", recoveredHours: 0.5 }),
          disputeLine({
            id: "b",
            entryId: "gone",
            roNumber: "9999",
            recoveredHours: 0.5,
          }),
        ]),
      ],
      entries: [liveRO([liveLine()])],
    });
    expect(noteCounts(container)).toEqual({
      goodwill: 1,
      periodTotal: 0,
      breakdown: 0,
    });
    // Control: the rows panel really is on screen, so the single goodwill
    // paragraph above is the in-panel one and not the standalone one having
    // silently replaced it.
    expect(screen.getByRole("button", { name: /^Apply 0\.5h to 1 line$/ })).toBeTruthy();
  });

  it("gives a period-total claim its own copy, never the goodwill wording", () => {
    // Case B. `closedRound` is scope "period" with no lines — the shape
    // disputeFromPack stores for a non-itemized claim. Nothing here is goodwill
    // and no RO was deleted; the claim simply never named a line.
    const container = renderCard({ allDisputes: [closedRound("d1", 4)] });
    expect(noteCounts(container)).toEqual({
      goodwill: 0,
      periodTotal: 1,
      breakdown: 0,
    });
  });

  it("stops asking once the period no longer reads short", () => {
    // Same claim, shortfall reconciled by hand. The note's entire ask is "go
    // type the paid hours in yourself"; once that's done it has to stop, or it
    // becomes permanent furniture the tech scrolls past.
    const container = renderCard({
      allDisputes: [closedRound("d1", 4)],
      shortedHours: 0,
    });
    expect(noteCounts(container)).toEqual({
      goodwill: 0,
      periodTotal: 0,
      breakdown: 0,
    });
  });

  it("leaves the missing-breakdown state showing only its own paragraph", () => {
    // The pre-existing state, unchanged: an itemized claim, a partial
    // settlement, no per-line recovery recorded. It already had a paragraph and
    // must not now collect a second one — needsLineBreakdown also sets
    // unmappedHours, which is exactly the trap.
    const container = renderCard({
      allDisputes: [
        itemizedRound(
          2,
          [
            disputeLine({ id: "a", entryId: "e1", claimedHours: 3 }),
            disputeLine({ id: "b", entryId: "e1", code: "ALN", claimedHours: 3 }),
          ],
          6,
        ),
      ],
      entries: [liveRO([liveLine(), liveLine({ id: "l2", customCode: "ALN" })])],
    });
    expect(noteCounts(container)).toEqual({
      goodwill: 0,
      periodTotal: 0,
      breakdown: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Several closed rounds, one Apply at a time
// ---------------------------------------------------------------------------
//
// The panel used to be planned from the NEWEST closed round only, so closing a
// second round hid the first round's still-unapplied Apply forever. It must
// now offer each round in turn — and never two buttons at once, because
// setLinePaidHours is an absolute SET and two applies in flight on a shared
// line both pass the frozen-vs-live guard.
describe("DisputeOutcomeCard recovery across claim rounds", () => {
  /** A one-line closed round claiming `code` at frozen paid 2. */
  function round(id: string, recovered: number, code: string): Dispute {
    return {
      ...closedRound(id, recovered),
      scope: "lines",
      claimedHours: 3,
      lines: [
        disputeLine({
          id: `${id}-l`,
          disputeId: id,
          code,
          flaggedHours: 5,
          paidHours: 2,
          claimedHours: 3,
        }),
      ],
    };
  }
  const X = (paid: number) =>
    liveLine({ id: "X", customCode: "BRK-F", flagHours: 5, paidHours: paid });
  const Y = (paid: number) =>
    liveLine({ id: "Y", customCode: "ALN", flagHours: 5, paidHours: paid });

  const applyButtons = () => screen.queryAllByRole("button", { name: /^Apply / });
  const disarmedNotes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("p")).filter((p) =>
      (p.textContent ?? "").includes("can't be applied automatically"),
    );

  it("offers exactly one Apply while two rounds on different lines are both armed", () => {
    renderCard({
      // Newest first, as listDisputes returns them.
      allDisputes: [round("r2", 1, "ALN"), round("r1", 0.5, "BRK-F")],
      entries: [liveRO([X(2), Y(2)])],
    });
    expect(applyButtons().map((b) => b.textContent)).toEqual([
      "Apply 1.0h to 1 line",
    ]);
  });

  it("offers the OLDER round once the newer one is applied, and applies that round's id", async () => {
    const actions = await import("@/app/actions/disputes");
    const apply = vi.mocked(actions.applyDisputeRecoveryAction);
    apply.mockResolvedValue({ appliedLines: 1, appliedHours: 0.5 });
    renderCard({
      allDisputes: [round("r2", 1, "ALN"), round("r1", 0.5, "BRK-F")],
      // R2's write landed on Y: 2 + 1.
      entries: [liveRO([X(2), Y(3)])],
    });
    const buttons = applyButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(["Apply 0.5h to 1 line"]);
    fireEvent.click(buttons[0]);
    expect(apply).toHaveBeenCalledWith("r1");
  });

  it("same line in both rounds: one Apply before, none after, and the stranded hours are explained once", () => {
    const rounds = [round("r2", 1, "BRK-F"), round("r1", 1, "BRK-F")];
    renderCard({ allDisputes: rounds, entries: [liveRO([X(2)])] });
    expect(applyButtons()).toHaveLength(1);
    cleanup();

    const container = renderCard({ allDisputes: rounds, entries: [liveRO([X(3)])] });
    expect(applyButtons()).toHaveLength(0);
    const notes = disarmedNotes(container);
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toMatchInlineSnapshot(
      `"Up to 1.0h recovered on your claims for Jul 16 – Jul 31 can't be applied automatically and may not be on your lines yet: RO 1001 BRK-F (1.0h). More than one claim asked for the same line and its paid hours have changed since, so FRT can't tell whether those hours came on top of the other claim's or were the same shortage asked for twice. Check each line against your pay stub, and only enter more paid hours in “Which lines came up short?” if the shop paid them separately."`,
    );
    // Not goodwill, not a missing breakdown — those paragraphs stay out.
    expect(noteCounts(container)).toEqual({ goodwill: 0, periodTotal: 0, breakdown: 0 });
  });

  it("says nothing when the shared line is paid to flag, even while ANOTHER line keeps the period short", () => {
    // Both rounds claimed X (flag 5) and X now reads 5. The period is still
    // 12.5h short on other lines, which the old period-wide gate let through
    // — telling the tech to enter hours onto a line already paid in full.
    const container = renderCard({
      allDisputes: [round("r2", 1, "BRK-F"), round("r1", 1, "BRK-F")],
      entries: [liveRO([X(5), Y(2)])],
      shortedHours: 12.5,
    });
    expect(disarmedNotes(container)).toHaveLength(0);
  });

  it("says nothing when both rounds re-claimed the same shortage and the line is now at flag (D2)", () => {
    // X flag 3 frozen 2; both rounds asked 1 and got 1; the newer applied.
    const r = (id: string): Dispute => ({
      ...round(id, 1, "BRK-F"),
      claimedHours: 1,
      lines: [
        disputeLine({ id: `${id}-l`, disputeId: id, code: "BRK-F", flaggedHours: 3, paidHours: 2, claimedHours: 1 }),
      ],
    });
    const container = renderCard({
      allDisputes: [r("r2"), r("r1")],
      entries: [liveRO([liveLine({ id: "X", customCode: "BRK-F", flagHours: 3, paidHours: 3 })])],
    });
    expect(applyButtons()).toHaveLength(0);
    expect(disarmedNotes(container)).toHaveLength(0);
  });

  it("says nothing after D2 when the tech later RAISES the flag (3 -> 4): no claim asked for that hour", () => {
    const r = (id: string): Dispute => ({
      ...round(id, 1, "BRK-F"),
      claimedHours: 1,
      lines: [
        disputeLine({ id: `${id}-l`, disputeId: id, code: "BRK-F", flaggedHours: 3, paidHours: 2, claimedHours: 1 }),
      ],
    });
    const container = renderCard({
      allDisputes: [r("r2"), r("r1")],
      entries: [liveRO([liveLine({ id: "X", customCode: "BRK-F", flagHours: 4, paidHours: 3 })])],
    });
    expect(disarmedNotes(container)).toHaveLength(0);
  });

  it("says nothing when the shared line is within rounding of flag (4.99 / 4.96 on 5.0 read PAID)", () => {
    for (const paid of [4.99, 4.96, 4.95]) {
      const container = renderCard({
        allDisputes: [round("r2", 1, "BRK-F"), round("r1", 1, "BRK-F")],
        entries: [liveRO([X(paid)])],
      });
      expect(disarmedNotes(container), String(paid)).toHaveLength(0);
      cleanup();
    }
    // 4.94 is short by the card's own rule; 0.06h may be missing.
    const container = renderCard({
      allDisputes: [round("r2", 1, "BRK-F"), round("r1", 1, "BRK-F")],
      entries: [liveRO([X(4.94)])],
    });
    expect(disarmedNotes(container)).toHaveLength(1);
  });

  it("never shows the stranded note for the line the offered Apply is about to write", () => {
    // r1 froze X at 1 and got 2; the tech typed X to 2. r2 froze 2, asked 3,
    // got 1 — armed on X. The Apply and a "possibly missing" note for the same
    // line used to sit side by side.
    const r1: Dispute = {
      ...round("r1", 2, "BRK-F"),
      lines: [disputeLine({ id: "r1-l", disputeId: "r1", code: "BRK-F", flaggedHours: 5, paidHours: 1, claimedHours: 4 })],
      claimedHours: 4,
    };
    const r2 = round("r2", 1, "BRK-F");
    const container = renderCard({ allDisputes: [r2, r1], entries: [liveRO([X(2)])] });
    expect(applyButtons().map((b) => b.textContent)).toEqual(["Apply 1.0h to 1 line"]);
    expect(disarmedNotes(container)).toHaveLength(0);
  });

  it("stops explaining stranded hours once the period no longer reads short", () => {
    const container = renderCard({
      allDisputes: [round("r2", 1, "BRK-F"), round("r1", 1, "BRK-F")],
      entries: [liveRO([X(3)])],
      shortedHours: 0,
    });
    // Same data as the previous case, which shows the note while short.
    expect(disarmedNotes(container)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The unmapped paragraph never says "nothing is owed" (wave 4)
// ---------------------------------------------------------------------------
//
// It used to read "maps to no line … goodwill above the ask, or an RO that's
// since been deleted. It stays on the claim and is not written anywhere." — but
// unmapped hours are also hours owed to a line the matcher refused to guess at,
// or to a claimed LINE (not RO) deleted since. Worded as goodwill, the tech
// reads "nothing to do". The copy now names the manual path, quoted exactly as
// PaidCheckCard titles it, like its sibling paragraphs.
describe("DisputeOutcomeCard unmapped copy", () => {
  const unmappedPara = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("p"))
      .map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t.includes("couldn't be matched to a line automatically"));

  it("reads as a to-do, not a dismissal, standalone and as the panel footnote", () => {
    const standalone = renderCard({
      allDisputes: [
        itemizedRound(0.5, [
          disputeLine({ entryId: "gone", roNumber: "9999", recoveredHours: 0.5 }),
        ]),
      ],
      entries: [liveRO([liveLine()])],
    });
    expect(unmappedPara(standalone)).toEqual([
      "0.5h of the recovery couldn't be matched to a line automatically — " +
        "goodwill above what you asked for, or a line or RO that's since been " +
        "deleted or changed. FRT won't write those hours anywhere, so if they " +
        "belong on a line that's still here, enter them in “Which lines " +
        "came up short?” yourself.",
    ]);
    const text = standalone.textContent ?? "";
    expect(text).not.toContain("maps to no line");
    expect(text).not.toContain("not written anywhere");
    cleanup();

    const footnote = renderCard({
      allDisputes: [
        itemizedRound(1, [
          disputeLine({ id: "a", entryId: "e1", recoveredHours: 0.5 }),
          disputeLine({ id: "b", entryId: "gone", roNumber: "9999", recoveredHours: 0.5 }),
        ]),
      ],
      entries: [liveRO([liveLine()])],
    });
    expect(unmappedPara(footnote)).toHaveLength(1);
    expect(unmappedPara(footnote)[0]).toContain("“Which lines came up short?”");
  });

  it("an id-era claim whose claimed line was deleted offers nothing onto its pending twin", () => {
    // The wave-4 reproducer at card level: claim on l1 (paid 0, id stored),
    // l1 deleted (FK SET NULL -> lineId null), l2 is a pending same-code,
    // same-flag twin nobody claimed. No Apply button; the hours are explained.
    const container = renderCard({
      allDisputes: [
        {
          ...itemizedRound(0.3, [
            disputeLine({ lineId: null, flaggedHours: 0.3, paidHours: 0, claimedHours: 0.3 }),
          ], 0.3),
          createdAt: "2026-09-28T00:00:00Z",
          generatedAt: "2026-09-28T00:00:00Z",
        },
      ],
      entries: [liveRO([liveLine({ id: "l2", flagHours: 0.3, paidHours: null })])],
    });
    expect(screen.queryByRole("button", { name: /^Apply / })).toBeNull();
    expect(noteCounts(container)).toEqual({ goodwill: 1, periodTotal: 0, breakdown: 0 });
  });
});
