"use client";

// The "Scan RO ticket" banner shown on new-RO entry. Wraps ScanRoButton and its
// OCR result callback. Presentational — all state lives in useLogRoForm.
import { Camera } from "lucide-react";
import type { OpCode, RoTemplate } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";
import { ScanRoButton } from "./ScanRoButton";

export function RoScanSection({
  library,
  templates,
  onResult,
}: {
  library: OpCode[];
  templates: RoTemplate[];
  onResult: (result: OcrResult) => void;
}) {
  return (
    <div className="scan-banner">
      <div className="ico">
        <Camera size={20} style={{ color: "var(--brand)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="label">Scan RO ticket</div>
        <div className="sub">Auto-fills RO#, vehicle and op codes</div>
      </div>
      <ScanRoButton library={library} templates={templates} onResult={onResult} />
    </div>
  );
}
