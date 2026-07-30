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
import { Info } from "lucide-react";
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
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={title}>
          <div className="info-bubble-body">{children}</div>
        </Modal>
      )}
    </>
  );
}
