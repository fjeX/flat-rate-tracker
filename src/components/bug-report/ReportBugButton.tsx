"use client";

// A page-body trigger for the same Report a Bug dialog the footer opens, for
// pages (FAQ) that send the tech there as the next step.
import { useState } from "react";
import { ReportBugModal } from "./ReportBugModal";

export function ReportBugButton({ label = "Report a Bug" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-line" onClick={() => setOpen(true)}>
        {label}
      </button>
      <ReportBugModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
