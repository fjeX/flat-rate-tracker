import { describe, expect, it } from "vitest";
import { deriveAutoFill, deriveMake } from "./default-make";

// These two functions replaced a mount effect that seeded `autoFill` and `make`
// from localStorage. The effect was the thing react-hooks/set-state-in-effect
// flagged; the risk in removing it is that the derivation is subtly different
// from the state machine it replaced. Every case below is a behaviour the old
// effect had, written down so the replacement cannot quietly drift from it.

describe("deriveAutoFill", () => {
  it("is on for a new RO when a make was saved", () => {
    expect(deriveAutoFill(null, false, "Toyota")).toBe(true);
  });

  it("is off for a new RO when nothing was saved", () => {
    expect(deriveAutoFill(null, false, "")).toBe(false);
  });

  it("is off while editing, even with a saved make", () => {
    // An existing RO's make belongs to that vehicle. Autofilling over it would
    // rewrite the record to whatever the tech last logged.
    expect(deriveAutoFill(null, true, "Toyota")).toBe(false);
  });

  it("obeys an explicit toggle over the stored state", () => {
    expect(deriveAutoFill(true, false, "")).toBe(true);
    expect(deriveAutoFill(false, false, "Toyota")).toBe(false);
  });

  it("stays on when the field is cleared to empty", () => {
    // THE REGRESSION THIS PINS: clearing the Make box writes "" to storage.
    // Without the caller pinning choice=true first, this would read as "nothing
    // saved" and the checkbox would uncheck itself mid-edit. handleMakeChange
    // pins it; this asserts the pin is what makes the difference.
    expect(deriveAutoFill(null, false, "")).toBe(false); // unpinned: would flip off
    expect(deriveAutoFill(true, false, "")).toBe(true); // pinned: stays on
  });
});

describe("deriveMake", () => {
  it("fills from the saved default when untouched and autofill is on", () => {
    expect(deriveMake(null, true, "Toyota")).toBe("Toyota");
  });

  it("is empty when untouched and autofill is off", () => {
    expect(deriveMake(null, false, "Toyota")).toBe("");
  });

  it("keeps an explicitly cleared field cleared", () => {
    // "" and null are NOT the same. If "" fell through to the saved default,
    // the box would refill itself on the next render and be unclearable.
    expect(deriveMake("", true, "Toyota")).toBe("");
  });

  it("prefers what the user typed over the saved default", () => {
    expect(deriveMake("Honda", true, "Toyota")).toBe("Honda");
  });

  it("shows an edited RO's own make regardless of the default", () => {
    // isEdit forces autoFill false, and the input seeds from the entry.
    expect(deriveMake("Subaru", deriveAutoFill(null, true, "Toyota"), "Toyota")).toBe("Subaru");
  });

  it("returns to the saved default after a reset that kept autofill on", () => {
    // resetForm sets makeInput back to null (not "") when autofill is on, so
    // the next RO starts pre-filled — matching the old "leave make alone" branch.
    expect(deriveMake(null, true, "Toyota")).toBe("Toyota");
  });
});
