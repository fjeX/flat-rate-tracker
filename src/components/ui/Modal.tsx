"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Written out in full because Tailwind scans source for literal class names —
// a computed `max-w-${size}` would be correct TypeScript and would silently
// ship with no width class at all.
const PANEL_MAX_W = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

// Bottom-sheet on mobile, centered dialog on desktop. Closes on backdrop
// click and Escape.
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /**
   * Desktop panel width. Mobile is always a full-width bottom sheet.
   *
   *   md — the default, for ordinary forms and confirmations.
   *   lg — forms with row grids (e.g. sub op codes, the RO detail lines).
   *   xl — a DIRECT-MANIPULATION surface, where the panel is the workspace
   *        rather than a container for fields. The RO template editor is the
   *        only one: you drag on a photo of a repair order to draw the region
   *        boxes the parser reads, so every pixel taken off the width is
   *        precision taken off the gesture.
   *
   * Sized here rather than by the caller because the focus trap, scroll lock
   * and max height are tuned together with it.
   */
  size?: "md" | "lg" | "xl";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Hold the latest onClose in a ref so the setup effect below can depend only
  // on `open`. Depending on `onClose` re-ran the whole effect on every render
  // (callers pass an inline handler → new identity each render), which yanked
  // focus back to the first focusable element (the ✕) on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    // Remember what had focus so we can hand it back on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function focusableEls(): HTMLElement[] {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap Tab / Shift+Tab within the panel.
      const els = focusableEls();
      if (els.length === 0) {
        // Nothing focusable inside — keep focus on the panel itself.
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the panel — the first focusable element, or the panel.
    const els = focusableEls();
    (els[0] ?? panelRef.current)?.focus();

    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prev;
      // Restore focus to whatever was focused before the modal opened.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`modal-panel max-h-[90vh] w-full ${PANEL_MAX_W[size]} overflow-y-auto rounded-t-[var(--radius)] border border-[var(--line)] bg-[var(--bg-1)] outline-none sm:rounded-[var(--radius)]`}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--fg-0)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full text-[var(--fg-2)] hover:bg-[var(--bg-3)] hover:text-[var(--fg-0)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
