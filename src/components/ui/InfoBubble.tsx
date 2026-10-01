"use client";

// A small ⓘ next to a card title that opens a plain-language explanation of
// what the card is for.
//
// The Pay Period page carries real domain weight — reconciliation, effective
// hourly, unpaid time — and a tech seeing it for the first time has no reason
// to know what any of it means for their paycheque. Every explanation should
// answer "why do I care", not just "what is this field".
//
// Deliberately a SIBLING of the card's expand/collapse toggle, never nested
// inside it: a button inside a button is invalid HTML and breaks keyboard
// navigation.
import { useState } from "react";
import { Modal } from "./Modal";

export function InfoBubble({
  title,
  label,
  children,
}: {
  // Modal heading — usually the card's own title.
  title: string;
  // Accessible name for the trigger. Defaults to a sentence built from `title`
  // so screen-reader users get more than "info".
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="info-bubble"
        onClick={() => setOpen(true)}
        aria-label={label ?? `What is "${title}"?`}
      >
        <svg className="info-bubble-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path className="info-bubble-i" d="M10.75 6.5h2.5V9h-2.5zm0 4h2.5v7h-2.5z" />
        </svg>
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={title}>
          <div className="info-bubble-body">{children}</div>
        </Modal>
      )}
    </>
  );
}
