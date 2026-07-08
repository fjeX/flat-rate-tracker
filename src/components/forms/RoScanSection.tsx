"use client";

// The "Scan RO ticket" banner shown on new-RO entry. Wraps ScanRoButton and its
// OCR result callback. Presentational — all state lives in useLogRoForm.
import { Camera, X } from "lucide-react";
import type { OpCode, RoTemplate } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";
import { ScanRoButton } from "./ScanRoButton";

export function RoScanSection({
  library,
  templates,
  onResult,
  onPhotoCaptured,
  photoAttached = false,
  onPhotoRemove,
}: {
  library: OpCode[];
  templates: RoTemplate[];
  onResult: (result: OcrResult) => void;
  // Present only when photo evidence is enabled (authenticated, not guest).
  onPhotoCaptured?: (blob: Blob) => void;
  photoAttached?: boolean;
  onPhotoRemove?: () => void;
}) {
  return (
    <div>
      <div className="scan-banner">
        <div className="ico">
          <Camera size={20} style={{ color: "var(--brand)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">Scan RO ticket</div>
          <div className="sub">Auto-fills RO#, vehicle and op codes</div>
        </div>
        <ScanRoButton
          library={library}
          templates={templates}
          onResult={onResult}
          onPhotoCaptured={onPhotoCaptured}
        />
      </div>

      {/* Evidence chip — the scanned photo is retained and saved with the RO. */}
      {photoAttached && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            borderRadius: 8,
            border: "1px solid color-mix(in oklab, var(--good) 35%, transparent)",
            background: "color-mix(in oklab, var(--good) 10%, transparent)",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--good)",
          }}
        >
          <Camera size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Photo attached — saved with this RO</span>
          {onPhotoRemove && (
            <button
              type="button"
              onClick={onPhotoRemove}
              aria-label="Remove attached photo"
              className="relative"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--good)",
                display: "grid",
                placeItems: "center",
                width: 44,
                height: 44,
                margin: -12,
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
