// @vitest-environment jsdom
//
// Pins Modal's panel width scale.
//
// The `size` prop replaced a `wide` boolean when the RO template editor moved
// onto this component. That editor is a direct-manipulation surface — you drag
// on a photo of a repair order to draw the region boxes the parser reads — and
// the boolean's widest setting (max-w-2xl) took 25% off the width it had as a
// hand-rolled overlay. Precision taken off a drag gesture is a real cost, so
// the scale gained an `xl` rung rather than the editor accepting the loss.
//
// Two things these tests exist to catch:
//
//  1. A DEFAULT THAT MOVED. Eleven of the sixteen consumers pass no size at
//     all. If `md` ever stops meaning max-w-md, every one of them silently
//     resizes and only the visual gate would notice, one route at a time.
//
//  2. A COMPUTED CLASS NAME. Tailwind scans source for literal strings, so
//     `max-w-${size}` type-checks, passes review, and ships a panel with no
//     width class at all. Asserting the concrete class is the only thing that
//     catches it — a test that merely re-derived the same template literal
//     would pass while the page broke.
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Modal } from "./Modal";

function panelFor(ui: React.ReactElement): HTMLElement {
  render(ui);
  // The panel is the dialog's only child element — grabbing it via the role
  // rather than a class keeps this about the rendered contract.
  const dialog = screen.getByRole("dialog");
  const panel = dialog.firstElementChild as HTMLElement | null;
  if (!panel) throw new Error("dialog rendered no panel");
  return panel;
}

describe("Modal panel width", () => {
  it("defaults to the narrow panel, the width most consumers never ask for", () => {
    const panel = panelFor(
      <Modal open onClose={() => {}} title="Default">
        <p>body</p>
      </Modal>,
    );
    expect(panel.className).toContain("max-w-md");
    expect(panel.className).not.toContain("max-w-2xl");
    expect(panel.className).not.toContain("max-w-4xl");
  });

  it("gives lg the width the old `wide` boolean produced", () => {
    const panel = panelFor(
      <Modal open onClose={() => {}} title="Wide" size="lg">
        <p>body</p>
      </Modal>,
    );
    expect(panel.className).toContain("max-w-2xl");
  });

  it("gives xl a genuinely wider panel than lg, for drag surfaces", () => {
    const panel = panelFor(
      <Modal open onClose={() => {}} title="Editor" size="xl">
        <p>body</p>
      </Modal>,
    );
    expect(panel.className).toContain("max-w-4xl");
    expect(panel.className).not.toContain("max-w-2xl");
  });

  it("emits a literal Tailwind class, not an interpolated one", () => {
    const panel = panelFor(
      <Modal open onClose={() => {}} title="Literal" size="xl">
        <p>body</p>
      </Modal>,
    );
    // A computed `max-w-${size}` would leave this exact string behind.
    expect(panel.className).not.toContain("max-w-xl ");
    expect(panel.className).not.toMatch(/max-w-(md|lg|sm)\b.*max-w-/);
    expect(panel.className).toMatch(/\bmax-w-4xl\b/);
  });

  it("keeps the dialog contract at every size", () => {
    for (const size of ["md", "lg", "xl"] as const) {
      const { unmount } = render(
        <Modal open onClose={() => {}} title={`T-${size}`} size={size}>
          <p>body</p>
        </Modal>,
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-label")).toBe(`T-${size}`);
      unmount();
    }
  });
});
