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
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { DisputeOutcomeCard } from "./DisputeOutcomeCard";
import type { Dispute } from "@/lib/types";

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
