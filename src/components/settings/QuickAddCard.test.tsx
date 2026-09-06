// @vitest-environment jsdom
//
// Covers settings-switch-action-naming for QuickAddCard: the switch's
// accessible name used to be action-phrased and state-dependent ("Disable
// quick add" / "Enable quick add"). Since Switch's aria-checked already
// conveys state, and role="switch" + a changing name reads backwards to a
// screen reader, the name must be a stable noun naming the thing controlled.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { QuickAddCard } from "./QuickAddCard";

afterEach(() => {
  localStorage.clear();
});

describe("QuickAddCard switch accessible name", () => {
  it("keeps a stable name across a toggle while aria-checked flips", async () => {
    render(<QuickAddCard />);

    // Mounted gate: the switch only renders post-mount (see component comment).
    const toggle = await screen.findByRole("switch", { name: "Quick Add RO" });
    expect(toggle.getAttribute("aria-checked")).toBe("true"); // enabled by default

    await act(async () => {
      fireEvent.click(toggle);
    });

    // Name must NOT have changed to "Enable quick add" — same element, same name.
    const afterToggle = screen.getByRole("switch", { name: "Quick Add RO" });
    expect(afterToggle).toBe(toggle);
    expect(afterToggle.getAttribute("aria-checked")).toBe("false");
  });
});
