// @vitest-environment jsdom
//
// Covers ro-template-editor-not-a-dialog: the RO Template Setup overlay used to
// be a bare `<div className="fixed inset-0 …">`. It looked and behaved like a
// modal (full-viewport backdrop, page behind unusable) but carried none of the
// contract — no role="dialog", no aria-modal, no accessible name, no
// Escape-to-close, no focus move on open, no focus restore, no scroll lock. It
// was the one overlay in its family that didn't render through the shared
// `Modal`, which has provided all of that for its four siblings all along.
//
// These assertions are deliberately about the *contract*, not about Modal's
// internals, so they'd still hold if the editor grew its own dialog wrapper.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { RoTemplate } from "@/lib/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: null }),
      }),
    },
  }),
}));

vi.mock("@/app/actions/ro-template", () => ({
  saveRoTemplateMetadata: vi.fn(() => Promise.resolve()),
}));

import { RoTemplateEditor } from "./RoTemplateEditor";

let onClose: Mock<(saved?: RoTemplate) => void>;

function renderEditor() {
  onClose = vi.fn<(saved?: RoTemplate) => void>();
  return render(
    <RoTemplateEditor userId="u1" initialTemplate={null} onClose={onClose} />,
  );
}

beforeEach(() => {
  document.body.style.overflow = "";
});

describe("RoTemplateEditor modal contract", () => {
  it("exposes a dialog with aria-modal and an accessible name", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog", { name: "RO Template Setup" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape", () => {
    renderEditor();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
    // No argument — a truthy first arg would be read as a saved template by
    // RoTemplateCard and spliced into the list.
    expect(onClose.mock.calls[0]).toHaveLength(0);
  });

  it("moves focus inside the dialog on open and locks background scroll", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog", { name: "RO Template Setup" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores focus to the trigger on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = renderEditor();
    expect(document.activeElement).not.toBe(trigger);
    act(() => {
      unmount();
    });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("has exactly one close control, and the region delete buttons don't collide with it", () => {
    renderEditor();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    // The heading is rendered once, by Modal — not duplicated by the editor.
    expect(screen.getAllByRole("heading", { name: "RO Template Setup" })).toHaveLength(1);
  });
});
