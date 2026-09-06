// @vitest-environment jsdom
//
// Covers settings-switch-action-naming for TrueTimeCard: the switch's name
// used to flip between "Contribute to True Time" / "Stop contributing to True
// Time" depending on state. aria-checked already carries the state, so the
// name must stay the stable, static thing being controlled.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrueTimeCard } from "./TrueTimeCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const setShareLaborTimesAction = vi.fn(async () => undefined);
vi.mock("@/app/actions/settings", () => ({
  setShareLaborTimesAction: (...a: unknown[]) => setShareLaborTimesAction(...(a as [])),
}));

beforeEach(() => vi.clearAllMocks());

describe("TrueTimeCard switch accessible name", () => {
  it("keeps a stable name across a toggle while aria-checked flips", async () => {
    render(<TrueTimeCard initialShare={false} />);

    const toggle = screen.getByRole("switch", { name: "Contribute to True Time" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    const afterToggle = screen.getByRole("switch", { name: "Contribute to True Time" });
    expect(afterToggle).toBe(toggle);
    expect(afterToggle.getAttribute("aria-checked")).toBe("true");
  });
});
