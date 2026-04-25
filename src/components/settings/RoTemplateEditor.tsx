"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveRoTemplateMetadata } from "@/app/actions/ro-template";
import type { FieldId, FieldRegion, RoTemplate } from "@/lib/types";

// ── Field config ──────────────────────────────────────────────────────────────

type FieldCfg = { label: string; desc: string; color: string; border: string; bg: string };

const FIELDS: Record<FieldId, FieldCfg> = {
  roNumber: { label: "RO Number",           desc: "The repair order number",       color: "text-orange-400", border: "border-orange-400", bg: "bg-orange-400/25" },
  vehicle:  { label: "Year / Make / Model", desc: "Vehicle info line",             color: "text-blue-400",   border: "border-blue-400",   bg: "bg-blue-400/25"   },
  vin:      { label: "VIN",                 desc: "17-character VIN",              color: "text-green-400",  border: "border-green-400",  bg: "bg-green-400/25"  },
  opCodes:  { label: "Op Codes",            desc: "Area containing the op codes",  color: "text-purple-400", border: "border-purple-400", bg: "bg-purple-400/25" },
};

const FIELD_ORDER: FieldId[] = ["roNumber", "vehicle", "vin", "opCodes"];

// ── Interaction state ─────────────────────────────────────────────────────────

type HandleId = "nw" | "ne" | "sw" | "se";

type Interaction =
  | { kind: "none" }
  | { kind: "drawing"; startX: number; startY: number; curX: number; curY: number }
  | { kind: "moving";  field: FieldId; grabX: number; grabY: number }
  | { kind: "resizing"; field: FieldId; handle: HandleId; startX: number; startY: number; orig: FieldRegion };

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

const HANDLE_HIT_RADIUS = 3.5; // percent — radius within which a corner handle is "hit"

function getPct(e: React.PointerEvent<HTMLDivElement>, el: HTMLDivElement) {
  const r = el.getBoundingClientRect();
  return {
    x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
    y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100),
  };
}

function findHit(pct: { x: number; y: number }, regions: FieldRegion[]):
  | { type: "handle"; field: FieldId; handle: HandleId }
  | { type: "box"; field: FieldId }
  | { type: "none" } {
  // Iterate in reverse so the last-drawn (topmost) box wins.
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    const corners: [HandleId, number, number][] = [
      ["nw", r.x, r.y],
      ["ne", r.x + r.width, r.y],
      ["sw", r.x, r.y + r.height],
      ["se", r.x + r.width, r.y + r.height],
    ];
    for (const [hid, hx, hy] of corners) {
      if (Math.hypot(pct.x - hx, pct.y - hy) < HANDLE_HIT_RADIUS) {
        return { type: "handle", field: r.field, handle: hid };
      }
    }
    if (
      pct.x >= r.x && pct.x <= r.x + r.width &&
      pct.y >= r.y && pct.y <= r.y + r.height
    ) {
      return { type: "box", field: r.field };
    }
  }
  return { type: "none" };
}

function applyResize(orig: FieldRegion, handle: HandleId, dx: number, dy: number): FieldRegion {
  let { x, y, width, height } = orig;
  const MIN = 3;
  if (handle === "nw") {
    const nx = clamp(orig.x + dx, 0, orig.x + orig.width - MIN);
    const ny = clamp(orig.y + dy, 0, orig.y + orig.height - MIN);
    width  = orig.width  - (nx - orig.x);
    height = orig.height - (ny - orig.y);
    x = nx; y = ny;
  } else if (handle === "ne") {
    const ny = clamp(orig.y + dy, 0, orig.y + orig.height - MIN);
    width  = clamp(orig.width  + dx, MIN, 100 - orig.x);
    height = orig.height - (ny - orig.y);
    y = ny;
  } else if (handle === "sw") {
    const nx = clamp(orig.x + dx, 0, orig.x + orig.width - MIN);
    width  = orig.width - (nx - orig.x);
    height = clamp(orig.height + dy, MIN, 100 - orig.y);
    x = nx;
  } else {
    width  = clamp(orig.width  + dx, MIN, 100 - orig.x);
    height = clamp(orig.height + dy, MIN, 100 - orig.y);
  }
  return { ...orig, x, y, width, height };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoTemplateEditor({
  userId,
  initialTemplate,
  onClose,
}: {
  userId: string;
  initialTemplate: RoTemplate | null;
  onClose: () => void;
}) {
  const [imageFile,      setImageFile]      = useState<File | null>(null);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [loadingImg,     setLoadingImg]     = useState(false);
  const [regions,        setRegions]        = useState<FieldRegion[]>(initialTemplate?.regions ?? []);
  const [activeField,    setActiveField]    = useState<FieldId>("roNumber");
  const [ghostBox,       setGhostBox]       = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  // Interaction is a ref (not state) so pointermove reads it synchronously.
  const ixRef         = useRef<Interaction>({ kind: "none" });
  // Keep a stable ref to activeField for use inside event handlers.
  const activeFieldRef = useRef<FieldId>(activeField);
  useEffect(() => { activeFieldRef.current = activeField; }, [activeField]);

  // Load existing template image on mount.
  useEffect(() => {
    if (!initialTemplate?.imageStoragePath || imageFile) return;
    setLoadingImg(true);
    createClient()
      .storage.from("ro-templates")
      .createSignedUrl(initialTemplate.imageStoragePath, 3600)
      .then(({ data }) => { if (data?.signedUrl) setImageObjectUrl(data.signedUrl); })
      .catch(() => {/* signed URL failure is non-fatal; user can re-upload */})
      .finally(() => setLoadingImg(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once — initialTemplate is stable on mount

  // Revoke blob URLs to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (imageObjectUrl?.startsWith("blob:")) URL.revokeObjectURL(imageObjectUrl);
    };
  }, [imageObjectUrl]);

  // ── Image handling ────────────────────────────────────────────────────────

  function handleImageFile(file: File) {
    if (imageObjectUrl?.startsWith("blob:")) URL.revokeObjectURL(imageObjectUrl);
    setImageFile(file);
    setImageObjectUrl(URL.createObjectURL(file));
    setRegions([]);
    setGhostBox(null);
    ixRef.current = { kind: "none" };
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!imageObjectUrl || !containerRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pct = getPct(e, containerRef.current);
    const hit = findHit(pct, regions);

    if (hit.type === "handle") {
      const orig = regions.find((r) => r.field === hit.field)!;
      ixRef.current = { kind: "resizing", field: hit.field, handle: hit.handle, startX: pct.x, startY: pct.y, orig };
    } else if (hit.type === "box") {
      const r = regions.find((r) => r.field === hit.field)!;
      ixRef.current = { kind: "moving", field: hit.field, grabX: pct.x - r.x, grabY: pct.y - r.y };
    } else {
      ixRef.current = { kind: "drawing", startX: pct.x, startY: pct.y, curX: pct.x, curY: pct.y };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const ix = ixRef.current;
    if (ix.kind === "none" || !containerRef.current) return;
    const pct = getPct(e, containerRef.current);

    if (ix.kind === "drawing") {
      ix.curX = pct.x;
      ix.curY = pct.y;
      const x = Math.min(ix.startX, pct.x);
      const y = Math.min(ix.startY, pct.y);
      setGhostBox({ x, y, w: Math.abs(pct.x - ix.startX), h: Math.abs(pct.y - ix.startY) });
    } else if (ix.kind === "moving") {
      const newX = clamp(pct.x - ix.grabX, 0, 100);
      const newY = clamp(pct.y - ix.grabY, 0, 100);
      setRegions((prev) => prev.map((r) => r.field === ix.field ? { ...r, x: newX, y: newY } : r));
    } else if (ix.kind === "resizing") {
      const dx = pct.x - ix.startX;
      const dy = pct.y - ix.startY;
      const updated = applyResize(ix.orig, ix.handle, dx, dy);
      setRegions((prev) => prev.map((r) => r.field === ix.field ? updated : r));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const ix = ixRef.current;
    if (ix.kind === "drawing" && containerRef.current) {
      const pct = getPct(e, containerRef.current);
      const x = Math.min(ix.startX, pct.x);
      const y = Math.min(ix.startY, pct.y);
      const w = Math.abs(pct.x - ix.startX);
      const h = Math.abs(pct.y - ix.startY);
      if (w > 2 && h > 2) {
        const field = activeFieldRef.current;
        setRegions((prev) => [
          ...prev.filter((r) => r.field !== field),
          { field, x, y, width: w, height: h },
        ]);
      }
      setGhostBox(null);
    }
    ixRef.current = { kind: "none" };
  }

  function onPointerCancel() {
    setGhostBox(null);
    ixRef.current = { kind: "none" };
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setErrorMsg(null);
    setSaving(true);
    try {
      const storagePath = `${userId}/template`;

      if (imageFile) {
        const { error } = await createClient()
          .storage.from("ro-templates")
          .upload(storagePath, imageFile, { upsert: true, contentType: imageFile.type || "image/jpeg" });
        if (error) throw error;
      }

      await saveRoTemplateMetadata(
        imageFile ? storagePath : initialTemplate!.imageStoragePath,
        regions,
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canSave = !!imageObjectUrl && regions.length > 0 && !saving;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 pt-8">
      <div className="relative flex w-full max-w-4xl flex-col gap-5 rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">RO Template Setup</h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              Upload a sample RO, pick a field, then drag on the image to mark where it appears.
              The scanner will only read those regions — much more accurate than scanning the whole page.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Field selector */}
        <div className="flex flex-wrap gap-2">
          {FIELD_ORDER.map((field) => {
            const cfg = FIELDS[field];
            const mapped = regions.some((r) => r.field === field);
            const active = activeField === field;
            return (
              <button
                key={field}
                onClick={() => setActiveField(field)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-all
                  ${active
                    ? `${cfg.border} ${cfg.bg} ${cfg.color}`
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
              >
                {mapped && <CheckCircle className="h-3.5 w-3.5" />}
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Image area */}
        {!imageObjectUrl ? (
          <div
            className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500"
            onClick={() => fileInputRef.current?.click()}
          >
            {loadingImg ? (
              <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
            ) : (
              <>
                <Upload className="h-7 w-7 text-zinc-500" />
                <p className="text-sm text-zinc-400">Upload a photo of your shop&apos;s RO</p>
                <p className="text-xs text-zinc-500">JPEG · PNG · WEBP</p>
              </>
            )}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="relative select-none overflow-hidden rounded-lg border border-zinc-700"
            style={{ touchAction: "none", cursor: "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageObjectUrl}
              alt="RO template"
              draggable={false}
              className="block w-full"
              style={{ userSelect: "none", pointerEvents: "none" }}
            />

            {/* Existing boxes */}
            {regions.map((r) => {
              const cfg = FIELDS[r.field];
              const cornerBase = "absolute h-3 w-3 rounded-sm border border-zinc-600 bg-white";
              return (
                <div
                  key={r.field}
                  className={`absolute border-2 ${cfg.border} ${cfg.bg}`}
                  style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
                >
                  {/* Label */}
                  <div
                    className={`pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-sm bg-zinc-900/90 px-1 py-0.5 text-[10px] font-semibold ${cfg.color}`}
                  >
                    {cfg.label}
                  </div>
                  {/* Corner resize handles */}
                  <div className={`${cornerBase} -left-1.5 -top-1.5 cursor-nw-resize`} />
                  <div className={`${cornerBase} -right-1.5 -top-1.5 cursor-ne-resize`} />
                  <div className={`${cornerBase} -bottom-1.5 -left-1.5 cursor-sw-resize`} />
                  <div className={`${cornerBase} -bottom-1.5 -right-1.5 cursor-se-resize`} />
                  {/* Delete button */}
                  <button
                    className="absolute -right-2.5 -top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRegions((prev) => prev.filter((reg) => reg.field !== r.field));
                    }}
                    aria-label={`Remove ${cfg.label} box`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {/* Ghost box while drawing */}
            {ghostBox && (
              <div
                className={`pointer-events-none absolute border-2 border-dashed ${FIELDS[activeField].border} ${FIELDS[activeField].bg}`}
                style={{ left: `${ghostBox.x}%`, top: `${ghostBox.y}%`, width: `${ghostBox.w}%`, height: `${ghostBox.h}%` }}
              />
            )}
          </div>
        )}

        {/* Hints + image change link */}
        {imageObjectUrl && (
          <p className="text-xs text-zinc-500">
            Pick a field above, then <strong className="text-zinc-400">drag</strong> on the image to draw a box.
            Drag a box to move it · drag its corners to resize it · red ✕ to delete.{" "}
            <button
              className="underline hover:text-zinc-200"
              onClick={() => fileInputRef.current?.click()}
            >
              Change image
            </button>
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageFile(f);
            e.target.value = "";
          }}
        />

        {errorMsg && (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {errorMsg}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
          <p className="text-sm text-zinc-500">
            {regions.length} / {FIELD_ORDER.length} fields mapped
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
