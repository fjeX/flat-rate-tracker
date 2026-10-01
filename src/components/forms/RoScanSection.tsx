"use client";

// The "Scan RO ticket" row in the "Before you start" zone, shown on new-RO
// entry. Wraps ScanRoButton and its OCR result callback. Presentational — all
// state lives in useLogRoForm.
import type { OpCode, RoTemplate } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";
import { ScanRoButton } from "./ScanRoButton";
import { LogIcon } from "./logParts";
import { StatusField } from "@/components/ui/StatusField";

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
    <div className="log-tool">
      <div className="log-tool-txt">
        <p className="log-lead">Scan RO ticket</p>
        <p className="log-sub">Auto-fills RO#, vehicle and op codes</p>
      </div>
      <ScanRoButton
        library={library}
        templates={templates}
        onResult={onResult}
        onPhotoCaptured={onPhotoCaptured}
      />

      {/* Evidence chip — the scanned photo is retained and saved with the RO. */}
      {photoAttached && (
        <StatusField tag="Note" inset className="log-scan-row">
          <div className="log-photo">
            <p>Photo attached — saved with this RO</p>
            {onPhotoRemove && (
              <button
                type="button"
                onClick={onPhotoRemove}
                aria-label="Remove attached photo"
                className="iconbtn"
              >
                <LogIcon name="x" small />
              </button>
            )}
          </div>
        </StatusField>
      )}
    </div>
  );
}
