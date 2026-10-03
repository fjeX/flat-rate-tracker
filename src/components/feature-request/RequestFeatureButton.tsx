"use client";

// A page-body trigger for the same Request a Feature dialog the footer opens,
// for pages (About, FAQ) that point the tech there.
import { useState } from "react";
import { RequestFeatureModal } from "./RequestFeatureModal";

export function RequestFeatureButton({ label = "Request a Feature" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-line" onClick={() => setOpen(true)}>
        {label}
      </button>
      <RequestFeatureModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
