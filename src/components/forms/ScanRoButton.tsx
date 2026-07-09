"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle, ChevronDown, ChevronUp, Info, Loader2, X } from "lucide-react";
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

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {/* No capture attribute — lets mobile browsers offer both camera and gallery. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {/* Button row: info icon + Scan RO button */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="First-time setup help"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: showInfo ? "var(--brand)" : "var(--fg-3)",
            display: "flex",
            alignItems: "center",
            padding: 2,
          }}
        >
          <Info className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleScanClick}
          disabled={status === "loading"}
          className="flex items-center gap-2 min-h-[44px] rounded-full bg-[var(--bg-3)] px-4 py-2 text-sm text-[var(--fg-1)] hover:bg-[var(--bg-4)] disabled:opacity-60"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4 text-[var(--brand)]" />
          )}
          {status === "loading" ? "Scanning…" : "Scan RO"}
        </button>
      </div>

      {/* Info dropdown — absolutely positioned, appears below the button row */}
      {showInfo && (
        <div style={{
          position: "absolute",
          right: 0,
          top: "calc(100% + 6px)",
          zIndex: 50,
          width: 260,
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--bg-2)",
          padding: 12,
          boxShadow: "var(--shadow-pop)",
        }}>
          <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: "var(--fg-2)" }}>
            First time scanning? 3 steps to set it up:
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            <li style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <span style={{ fontFamily: "monospace", color: "var(--brand)", flexShrink: 0 }}>1.</span>
              <span>Go to{" "}<Link href="/settings" style={{ color: "var(--brand)" }}>Settings</Link>{" "}and click <span style={{ color: "var(--fg-1)" }}>Add Template</span>.</span>
            </li>
            <li style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <span style={{ fontFamily: "monospace", color: "var(--brand)", flexShrink: 0 }}>2.</span>
              <span>Upload a photo of your RO form and draw boxes around each field.</span>
            </li>
            <li style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <span style={{ fontFamily: "monospace", color: "var(--brand)", flexShrink: 0 }}>3.</span>
              <span>Come back here and tap <span style={{ color: "var(--fg-1)" }}>Scan RO</span> — the form will auto-fill.</span>
            </li>
          </ol>
        </div>
      )}

      {/* Template picker — shown only when user has multiple templates */}
      {pickerOpen && (
        <div className="card-inset w-full p-2 shadow-[var(--shadow-pop)]">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-[var(--fg-2)]">Which template?</p>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded p-0.5 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              aria-label="Close picker"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handlePickTemplate(t)}
                className="w-full min-h-[44px] rounded-[var(--radius-sm)] bg-[var(--bg-3)] px-3 py-2 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg-4)]"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === "success" && summary && (
        <p className="flex items-center gap-1 text-xs text-[var(--good)]">
          <CheckCircle className="h-3 w-3 flex-shrink-0" />
          {summary}
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-[var(--bad)]">
          {summary ?? "Scan failed — fill in manually."}
        </p>
      )}

      {/* Scan details — hidden on high-confidence full success */}
      {debugRegions && debugRegions.length > 0 && !(status === "success" && confidence === "high") && (
        <div className="w-full text-right">
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)]"
          >
            {showDebug ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDebug ? "Hide details" : "Scan details"}
          </button>

          {showDebug && (
            <div className="card-inset mt-1 w-full p-3 text-left">
              <div className="space-y-2">
                {debugRegions.map((r) => {
                  const { icon, label } = getRegionStatus(r);
                  return (
                    <div key={r.field} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--fg-1)]">{FIELD_LABELS[r.field]}</span>
                        <span className={`flex items-center gap-1 text-xs ${icon === "success" ? "text-[var(--good)]" : icon === "partial" ? "text-[var(--warn)]" : "text-[var(--fg-3)]"}`}>
                          {icon === "success" && <CheckCircle className="h-3 w-3 flex-shrink-0" />}
                          {icon === "partial" && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                          {icon === "none"    && <X className="h-3 w-3 flex-shrink-0" />}
                          {label}
                        </span>
                      </div>
                      {r.rawText && (
                        <p className="truncate text-xs text-[var(--fg-3)]">
                          Scanned: {r.rawText.replace(/\n/g, " ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
