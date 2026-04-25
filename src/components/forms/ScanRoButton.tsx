"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, Loader2 } from "lucide-react";
import type { OpCode, RoTemplate } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";

type Props = {
  library: OpCode[];
  template: RoTemplate | null;
  onResult: (result: OcrResult) => void;
};

type Status = "idle" | "loading" | "success" | "error";

// Tesseract Page Segmentation Modes used per field type.
// SINGLE_LINE (7): for fields that are one line of text (RO number, VIN).
// SINGLE_BLOCK (6): for fields that may span multiple lines (vehicle, op codes).
const FIELD_PSM: Record<string, string> = {
  roNumber: "7",
  vin:      "7",
  vehicle:  "6",
  opCodes:  "6",
};

// VIN only uses uppercase letters (minus I, O, Q) and digits — whitelisting
// those characters cuts out OCR noise for the most error-prone field.
const FIELD_WHITELIST: Record<string, string> = {
  vin: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789 :\n",
};

export function ScanRoButton({ library, template, onResult }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus]   = useState<Status>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "success") return;
    timerRef.current = setTimeout(() => { setStatus("idle"); setSummary(null); }, 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [status]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStatus("loading");
    setSummary(null);

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
        }

        await worker.terminate();

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
      }

      onResult(result);

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
    <div className="flex flex-col items-end gap-1">
      {/* No capture attribute — lets mobile browsers offer both camera and gallery. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "loading"}
        className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-60"
      >
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4 text-orange-400" />
        )}
        {status === "loading" ? "Scanning…" : "Scan RO"}
      </button>

      {status === "success" && summary && (
        <p className="flex items-center gap-1 text-xs text-green-400">
          <CheckCircle className="h-3 w-3 flex-shrink-0" />
          {summary}
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-400">
          {summary ?? "Scan failed — fill in manually."}
        </p>
      )}
    </div>
  );
}
