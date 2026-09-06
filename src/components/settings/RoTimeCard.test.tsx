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

const setTrackRoTimeAction = vi.fn(async () => undefined);
vi.mock("@/app/actions/settings", () => ({
  setTrackRoTimeAction: (...a: unknown[]) => setTrackRoTimeAction(...(a as [])),
}));

beforeEach(() => vi.clearAllMocks());

describe("RoTimeCard switch accessible name", () => {
  it("keeps a stable name across a toggle while aria-checked flips", async () => {
    render(<RoTimeCard initialTrack={false} />);

    const toggle = screen.getByRole("switch", { name: "Record a time on each RO" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    const afterToggle = screen.getByRole("switch", { name: "Record a time on each RO" });
    expect(afterToggle).toBe(toggle);
    expect(afterToggle.getAttribute("aria-checked")).toBe("true");
  });
});
