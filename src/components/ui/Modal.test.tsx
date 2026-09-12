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
import { describe, it, expect, beforeEach } from "vitest";
import { Modal, __resetScrollLockForTests } from "./Modal";

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

// Bug report 6180397c — "unable to scroll down the page unless refreshing".
// Modal is the only writer of document.body.style.overflow in the app, so a
// page that stays unscrollable after every dialog is gone means the lock was
// released in the wrong order. Each case below leaked with the old
// save-and-restore-my-own-snapshot implementation.
describe("Modal body scroll lock", () => {
  beforeEach(() => __resetScrollLockForTests());

  it("locks while open and restores the page's original value on close", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Modal open onClose={() => {}} title="One">
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("releases when a stacked pair unmounts together", () => {
    // Quick Add → sub-op-code picker; timer save → confirm. Whatever order
    // React runs the two cleanups in, the last one out must restore the page.
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Outer">
        <Modal open onClose={() => {}} title="Inner">
          <p>body</p>
        </Modal>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("releases when two overlapping modals close in non-stack order", () => {
    const a = render(
      <Modal open onClose={() => {}} title="A">
        <p>a</p>
      </Modal>,
    );
    const b = render(
      <Modal open onClose={() => {}} title="B">
        <p>b</p>
      </Modal>,
    );
    a.unmount(); // first-opened closes first — B must keep the lock…
    expect(document.body.style.overflow).toBe("hidden");
    b.unmount(); // …and the last one out restores the page.
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the lock while an inner modal closes and the outer stays open", () => {
    // Effects mount child-first, so with per-instance snapshots the inner
    // modal captured "" and restored it here — unlocking the page under a
    // modal that was still open, and leaving "hidden" for the outer to write
    // back later. This is the leak the reporter hit.
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Outer">
        <Modal open onClose={() => {}} title="Inner">
          <p>body</p>
        </Modal>
      </Modal>,
    );
    rerender(
      <Modal open onClose={() => {}} title="Outer">
        <p>no inner</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
  });
});
