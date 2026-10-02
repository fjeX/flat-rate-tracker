// @vitest-environment jsdom
//
// server-action-thrown-refusals-masked: setPeriodOverrideAction answers the
// "would leave N days in no pay period" refusal with { error } instead of
// throwing it (a thrown message is masked in production). The modal must show
// that sentence in its error slot, stay open, and not refresh — a caller that
// ignored the return value would close the modal as if the dates had saved.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { PeriodOverrideModal } from "./PeriodOverrideModal";

const refresh = vi.fn();
const setPeriodOverrideAction = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/settings", () => ({
  setPeriodOverrideAction: (...a: unknown[]) => setPeriodOverrideAction(...a),
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const SENTENCE =
  "That would leave Jul 15 – Jul 17 in no pay period. The previous one ends Jul 14, so this one has to start Jul 15 or earlier.";

function openAndSave(onClose = vi.fn()) {
  render(
    <PeriodOverrideModal
      open
      periodKey="2026-07-B"
      initialRange={{ key: "2026-07-B", start: "2026-07-16", end: "2026-07-31" }}
      entries={[]}
      clocks={[]}
      unpaid={[]}
      schedule={null}
      rates={{}}
      paidFlagHours={null}
      onClose={onClose}
    />,
  );
  // Make the form dirty so Save is enabled.
  fireEvent.change(screen.getByLabelText(/start/i), { target: { value: "2026-07-18" } });
  return onClose;
}

describe("PeriodOverrideModal — a refusal returned as data", () => {
  it("renders the sentence in the error slot and stays open", async () => {
    setPeriodOverrideAction.mockResolvedValue({ error: SENTENCE });
    const onClose = openAndSave();
    await act(async () => {
      fireEvent.submit(document.getElementById("period-override-form")!);
    });
    const alert = await screen.findByRole("alert");
    expect(document.getElementById("period-override-error")?.textContent).toBe(SENTENCE);
    expect(alert.textContent).toContain(SENTENCE);
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes and refreshes on { ok: true }", async () => {
    setPeriodOverrideAction.mockResolvedValue({ ok: true });
    const onClose = openAndSave();
    await act(async () => {
      fireEvent.submit(document.getElementById("period-override-form")!);
    });
    expect(refresh).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still surfaces a thrown failure through the catch", async () => {
    setPeriodOverrideAction.mockRejectedValue(new Error("network down"));
    const onClose = openAndSave();
    await act(async () => {
      fireEvent.submit(document.getElementById("period-override-form")!);
    });
    await screen.findByRole("alert");
    expect(document.getElementById("period-override-error")?.textContent).toBe("network down");
    expect(onClose).not.toHaveBeenCalled();
  });
});
