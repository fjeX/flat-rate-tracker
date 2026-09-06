// @vitest-environment jsdom
//
// Covers settings-switch-action-naming for RoTimeCard: the switch's name used
// to flip between "Record a time on each RO" / "Stop recording a time on each
// RO" depending on state. aria-checked already carries the state, so the name
// must stay the stable, static thing being controlled.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoTimeCard } from "./RoTimeCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const VISIBLE_HEADING = "Time of day on each RO";

const setTrackRoTimeAction = vi.fn(async () => undefined);
vi.mock("@/app/actions/settings", () => ({
  setTrackRoTimeAction: (...a: unknown[]) => setTrackRoTimeAction(...(a as [])),
}));

beforeEach(() => vi.clearAllMocks());

describe("RoTimeCard switch accessible name", () => {
  // WCAG 2.5.3 Label in Name. Switch.tsx documents that `label` is the
  // switch's ONLY accessible name, and the card's visible heading is what a
  // speech-input user will actually say. Read the heading out of the DOM
  // rather than hard-coding it in one place only, so renaming the card
  // without renaming the switch fails here.
  it("contains the card's visible heading", () => {
    render(<RoTimeCard initialTrack={false} />);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent?.trim()).toBe(VISIBLE_HEADING);

    const toggle = screen.getByRole("switch");
    const name = toggle.getAttribute("aria-label") ?? "";
    expect(name).toContain(heading.textContent?.trim());
  });

  it("keeps a stable name across a toggle while aria-checked flips", async () => {
    render(<RoTimeCard initialTrack={false} />);

    const toggle = screen.getByRole("switch", { name: VISIBLE_HEADING });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    const afterToggle = screen.getByRole("switch", { name: VISIBLE_HEADING });
    expect(afterToggle).toBe(toggle);
    expect(afterToggle.getAttribute("aria-checked")).toBe("true");
  });
});
