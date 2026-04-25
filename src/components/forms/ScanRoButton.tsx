"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, Loader2 } from "lucide-react";
import type { OpCode } from "@/lib/types";
import type { OcrResult } from "@/lib/ocr";

type Props = {
  library: OpCode[];
  onResult: (result: OcrResult) => void;
};

type Status = "idle" | "loading" | "success" | "error";

export function ScanRoButton({ library, onResult }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss the success banner after 4 s.
  useEffect(() => {
    if (status !== "success") return;
    timerRef.current = setTimeout(() => {
      setStatus("idle");
      setSummary(null);
    }, 4000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStatus("loading");
    setSummary(null);
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const { data } = await Tesseract.recognize(file, "eng");
      const { parseOcrText } = await import("@/lib/ocr");
      const result = parseOcrText(data.text, library);
      onResult(result);

      // Build a human-readable summary of what was detected.
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
