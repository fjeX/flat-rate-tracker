"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LogIcon } from "./logParts";
import { StatusField } from "@/components/ui/StatusField";
import type { FieldId, OpCode, RoTemplate } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";

type Props = {
  library: OpCode[];
  templates: RoTemplate[];
  onResult: (result: OcrResult) => void;
  // Called with the raw captured file so the form can retain it as evidence and
  // upload it when the RO is saved. Omitted in guest mode (no photo storage).
  onPhotoCaptured?: (blob: Blob) => void;
};

type Status = "idle" | "loading" | "success" | "error";

// Tesseract Page Segmentation Modes used per field type.
// SINGLE_LINE (7): for fields that are one line of text (RO number, VIN).
// SINGLE_BLOCK (6): for fields that may span multiple lines (vehicle).
// SPARSE_TEXT (11): for op codes in table/list layouts — finds text in any order.
const FIELD_PSM: Record<string, string> = {
  roNumber: "7",
  vin:      "7",
  vehicle:  "6",
  opCodes:  "11",
};

// VIN only uses uppercase letters (minus I, O, Q) and digits — whitelisting
// those characters cuts out OCR noise for the most error-prone field.
const FIELD_WHITELIST: Record<string, string> = {
  vin: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789 :\n",
};

const FIELD_LABELS: Record<FieldId, string> = {
  roNumber: "RO Number",
  vehicle:  "Year / Make / Model",
  vin:      "VIN",
  opCodes:  "Op Codes",
};

type RegionDebug = {
  field: FieldId;
  rawText: string;
  extracted: Partial<Omit<OcrResult, "confidence">>;
};

type RegionStatus = { icon: "success" | "partial" | "none"; label: string };

function getRegionStatus(r: RegionDebug): RegionStatus {
  const e = r.extracted;
  if (r.field === "opCodes") {
    const count = e.opCodeIds?.length ?? 0;
    if (count > 0) return { icon: "success", label: `${count} op code${count > 1 ? "s" : ""}` };
    if (r.rawText) return { icon: "partial", label: "Read but none matched" };
    return { icon: "none", label: "Not detected" };
  }
  if (r.field === "vehicle") {
    const parts = [e.year, e.make, e.model].filter(Boolean);
    if (parts.length === 3) return { icon: "success", label: parts.join(" ") };
    if (parts.length > 0) return { icon: "partial", label: `${parts.join(" ")} (partial)` };
    if (r.rawText) return { icon: "partial", label: "Read but not matched" };
    return { icon: "none", label: "Not detected" };
  }
  if (r.field === "roNumber") {
    if (e.roNumber) return { icon: "success", label: e.roNumber };
    if (r.rawText) return { icon: "partial", label: "Read but not matched" };
    return { icon: "none", label: "Not detected" };
  }
  if (r.field === "vin") {
    if (e.vin) return { icon: "success", label: `…${e.vin.slice(-6)}` };
    if (r.rawText) return { icon: "partial", label: "Read but not matched" };
    return { icon: "none", label: "Not detected" };
  }
  return { icon: "none", label: "Not detected" };
}

export function ScanRoButton({ library, templates, onResult, onPhotoCaptured }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Holds the template selected for the current scan (set before opening file picker).
  const activeTemplateRef = useRef<RoTemplate | null>(null);
  const [status, setStatus]           = useState<Status>("idle");
  const [summary, setSummary]         = useState<string | null>(null);
  const [debugRegions, setDebugRegions] = useState<RegionDebug[] | null>(null);
  const [showDebug, setShowDebug]     = useState(false);
  const [confidence, setConfidence]   = useState<"high" | "low" | null>(null);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [showInfo, setShowInfo]       = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "success") return;
    timerRef.current = setTimeout(() => { setStatus("idle"); setSummary(null); }, 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [status]);

  function handleScanClick() {
    if (templates.length > 1) {
      setPickerOpen(true);
    } else {
      activeTemplateRef.current = templates[0] ?? null;
      inputRef.current?.click();
    }
  }

  function handlePickTemplate(t: RoTemplate) {
    setPickerOpen(false);
    activeTemplateRef.current = t;
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // Retain the captured photo as evidence regardless of OCR outcome — even a
    // failed scan is a photo worth keeping. The form uploads it on save.
    onPhotoCaptured?.(file);
    setStatus("loading");
    setSummary(null);
    setDebugRegions(null);
    setShowDebug(false);
    setConfidence(null);

    const template = activeTemplateRef.current;

    try {
      const Tesseract = (await import("tesseract.js")).default;
      const { cropImageRegion, extractFieldFromText, parseOcrText } = await import("@/lib/ocr");

      let result: OcrResult;

      if (template && template.regions.length > 0) {
        // ── Region-based scan ─────────────────────────────────────────────────
        // 1. Crop all regions and spin up the Tesseract worker in parallel so
        //    the (expensive) worker init overlaps with canvas work.
        // 2. For each region, tune Tesseract's page segmentation mode and
        //    character whitelist before recognizing — one worker, sequential
        //    recognitions, so only one WASM instance lives in memory.
        // 3. Merge partial results into one OcrResult.

        const [worker, crops] = await Promise.all([
          Tesseract.createWorker("eng"),
          Promise.all(template.regions.map((r) => cropImageRegion(file, r))),
        ]);

        const partial: Partial<Omit<OcrResult, "confidence">> = {};
        const debugLog: RegionDebug[] = [];

        for (let i = 0; i < template.regions.length; i++) {
          const region = template.regions[i];
          const params: Record<string, string> = {
            tessedit_pageseg_mode: FIELD_PSM[region.field] ?? "6",
          };
          if (FIELD_WHITELIST[region.field]) {
            params.tessedit_char_whitelist = FIELD_WHITELIST[region.field];
          }
          await worker.setParameters(params);
          const { data } = await worker.recognize(crops[i]);
          const fields = extractFieldFromText(data.text, region.field, library);
          Object.assign(partial, fields);

          debugLog.push({
            field: region.field,
            rawText: data.text.trim(),
            extracted: fields,
          });
        }

        await worker.terminate();
        setDebugRegions(debugLog);

        const fieldsFound = [partial.roNumber, partial.year, partial.make, partial.model].filter(Boolean).length;
        result = {
          roNumber:  partial.roNumber  ?? "",
          year:      partial.year      ?? "",
          make:      partial.make      ?? "",
          model:     partial.model     ?? "",
          vin:       partial.vin       ?? "",
          opCodeIds: partial.opCodeIds ?? [],
          confidence: fieldsFound >= 3 ? "high" : "low",
        };
      } else {
        // ── Fallback: full-image scan ─────────────────────────────────────────
        const { data } = await Tesseract.recognize(file, "eng");
        result = parseOcrText(data.text, library);
        setDebugRegions([{
          field: "vehicle",
          rawText: data.text.trim(),
          extracted: { roNumber: result.roNumber, year: result.year, make: result.make, model: result.model, vin: result.vin },
        }]);
      }

      onResult(result);
      setConfidence(result.confidence);
      setShowDebug(result.confidence === "low");

      const parts: string[] = [];
      if (result.roNumber) parts.push(`RO# ${result.roNumber}`);
      if (result.year || result.make || result.model)
        parts.push([result.year, result.make, result.model].filter(Boolean).join(" "));
      if (result.vin) parts.push(`VIN …${result.vin.slice(-6)}`);
      if (result.opCodeIds.length > 0)
        parts.push(`${result.opCodeIds.length} op code${result.opCodeIds.length > 1 ? "s" : ""}`);

      setSummary(parts.length ? parts.join(" · ") : "Nothing detected");
      setStatus(parts.length ? "success" : "error");
    } catch {
      setStatus("error");
      setSummary(null);
    }
  }

  // `display: contents` on the wrapper: the button row stays beside the "Scan RO
  // ticket" text in RoScanSection's tool row, while the picker, result note and
  // details wrap onto full-width rows under it.
  return (
    <div className="log-scan">
      {/* No capture attribute — lets mobile browsers offer both camera and gallery. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {/* Button row: info icon + Scan RO button */}
      <div className="log-scan-btns">
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="First-time setup help"
          aria-expanded={showInfo}
          className="iconbtn"
        >
          <LogIcon name="info" />
        </button>
        <button
          type="button"
          onClick={handleScanClick}
          disabled={status === "loading"}
          aria-busy={status === "loading" || undefined}
          className="btn btn-line"
        >
          <LogIcon name="camera" small />
          {status === "loading" ? "Scanning…" : "Scan RO"}
        </button>
      </div>

      {/* First-time help — a full-width note under the row, not a popover */}
      {showInfo && (
        <div className="log-scan-row log-scan-help">
          <p className="log-scan-help-h">First time scanning? 3 steps to set it up:</p>
          <ol>
            <li>
              <span className="num">1.</span>
              <span>Go to{" "}<Link href="/settings">Settings</Link>{" "}and click <b>Add Template</b>.</span>
            </li>
            <li>
              <span className="num">2.</span>
              <span>Upload a photo of your RO form and draw boxes around each field.</span>
            </li>
            <li>
              <span className="num">3.</span>
              <span>Come back here and tap <b>Scan RO</b> — the form will auto-fill.</span>
            </li>
          </ol>
        </div>
      )}

      {/* Template picker — shown only when user has multiple templates */}
      {pickerOpen && (
        <div className="log-scan-row log-scan-picker">
          <div className="log-scan-picker-head">
            <p className="log-scan-help-h">Which template?</p>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="iconbtn"
              aria-label="Close picker"
            >
              <LogIcon name="x" small />
            </button>
          </div>
          <div className="log-scan-picker-list">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handlePickTemplate(t)}
                className="btn btn-line"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === "success" && summary && (
        <StatusField tag="Read" tone="good" inset className="log-scan-row">
          <p>{summary}</p>
        </StatusField>
      )}
      {status === "error" && (
        <StatusField tag="Fix" inset className="log-scan-row">
          <p>{summary ?? "Scan failed — fill in manually."}</p>
        </StatusField>
      )}

      {/* Scan details — hidden on high-confidence full success */}
      {debugRegions && debugRegions.length > 0 && !(status === "success" && confidence === "high") && (
        <div className="log-scan-row">
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            aria-expanded={showDebug}
            className="btn btn-quiet btn-sm"
          >
            {showDebug ? "Hide details" : "Scan details"}
            <LogIcon name="chev" small className="chev" />
          </button>

          {showDebug && (
            <ul className="log-scan-details">
              {debugRegions.map((r) => {
                const { icon, label } = getRegionStatus(r);
                return (
                  <li key={r.field}>
                    <div className="log-scan-detail-top">
                      <span className="log-scan-detail-k">{FIELD_LABELS[r.field]}</span>
                      <span className="log-scan-detail-v">
                        <Badge tone={icon === "success" ? "good" : icon === "partial" ? "warn" : "neutral"}>
                          {icon === "success" ? "Read" : icon === "partial" ? "Partial" : "None"}
                        </Badge>
                        {label}
                      </span>
                    </div>
                    {r.rawText && (
                      <p className="log-scan-detail-raw">
                        Scanned: {r.rawText.replace(/\n/g, " ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
