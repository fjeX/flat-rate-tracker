// @vitest-environment jsdom
//
// LogRoForm renders <RetroTimePrompt> unconditionally, so this component is
// mounted once for the life of the page and "closing" it is just a prop change.
// These tests therefore NEVER unmount between the two opens — a test that
// remounts passes against the broken code and proves nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { RetroTimePrompt } from "./RetroTimePrompt";
import type { RetroCandidate } from "@/lib/retro-capture";

const setA: RetroCandidate[] = [
  { lineId: "line-a", code: "WATERPUMP", description: "Water pump", flagHours: 3 },
];
const setB: RetroCandidate[] = [
  { lineId: "line-b", code: "TIMINGBELT", description: "Timing belt", flagHours: 5 },
];

function button(label: string) {
  const btn = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no button labelled "${label}"`);
  return btn as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Pick the first time bucket chip — any answer unlocks "Save time". */
function pickFirstBucket() {
  const chip = document.querySelector("button.filter-chip") as HTMLButtonElement;
  if (!chip) throw new Error("no bucket chips rendered");
  click(chip);
}

beforeEach(() => vi.clearAllMocks());

describe("RetroTimePrompt — reopening after a save, same mounted instance", () => {
  it("is not stuck on 'Saving…' the second time it opens", () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();

    // Harness: `open` is derived from candidates exactly as LogRoForm does it.
    function Harness({ candidates }: { candidates: RetroCandidate[] }) {
      return (
        <RetroTimePrompt
          open={candidates.length > 0}
          candidates={candidates}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      );
    }

    const { rerender } = render(<Harness candidates={setA} />);

    // --- First open: answer and save.
    pickFirstBucket();
    click(button("Save time"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving…")).toBeTruthy();

    // --- submitRetro → finishRetro() clears the candidate list. No unmount.
    rerender(<Harness candidates={[]} />);
    expect(document.querySelector(".modal-panel")).toBeNull();

    // --- Second retro-eligible save in the same page session (Save & New).
    rerender(<Harness candidates={setB} />);

    // Stuck-state assertions. Against the broken code the label is still
    // "Saving…", so both of these fail (and button("Save time") throws).
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(button("Skip").disabled).toBe(false);
    // Disabled only because nothing is answered yet — the fresh-open state.
    expect(button("Save time").disabled).toBe(true);

    // And it actually works: answering re-enables it and fires onSubmit again,
    // with the NEW line's id only — stale picks must not ride along.
    pickFirstBucket();
    expect(button("Save time").disabled).toBe(false);
    click(button("Save time"));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(Object.keys(onSubmit.mock.calls[1][0])).toEqual(["line-b"]);
  });

  it("keeps Skip clickable even while a save is in flight", () => {
    const onSkip = vi.fn();
    render(
      <RetroTimePrompt
        open
        candidates={setA}
        onSubmit={vi.fn()}
        onSkip={onSkip}
      />,
    );

    pickFirstBucket();
    click(button("Save time"));
    expect(screen.getByText("Saving…")).toBeTruthy();

    expect(button("Skip").disabled).toBe(false);
    click(button("Skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
