"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatusField } from "@/components/ui/StatusField";
import { createClient } from "@/lib/supabase/client";
import { saveRoTemplateMetadata } from "@/app/actions/ro-template";
import type { FieldId, FieldRegion, RoTemplate } from "@/lib/types";
import { actionErrorMessage } from "@/lib/action-error";

// ── Field config ──────────────────────────────────────────────────────────────

type FieldCfg = { label: string; desc: string; hue: string };

// Field boxes are categorical (4 distinct hues to tell regions apart on an
// image overlay), not semantic status colors. The hues are data and live in
// dlg-template.css (.tpl-f-<field> sets --tagc), tuned per theme.
const FIELDS: Record<FieldId, FieldCfg> = {
  roNumber: { label: "RO Number",           desc: "The repair order number",       hue: "tpl-f-roNumber" },
  vehicle:  { label: "Year / Make / Model", desc: "Vehicle info line",             hue: "tpl-f-vehicle"  },
  vin:      { label: "VIN",                 desc: "17-character VIN",              hue: "tpl-f-vin"      },
  opCodes:  { label: "Op Codes",            desc: "Area containing the op codes",  hue: "tpl-f-opCodes"  },
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
  onClose: (saved?: RoTemplate) => void;
}) {
  const [imageFile,      setImageFile]      = useState<File | null>(null);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  // Seeded true when there is a stored image to fetch, so the effect below only
  // ever turns it OFF. Starting false and flipping it on inside the effect meant
  // one render advertising "no image, none loading" before the spinner appeared.
  const [loadingImg,     setLoadingImg]     = useState(() => !!initialTemplate?.imageStoragePath);
  const [regions,        setRegions]        = useState<FieldRegion[]>(initialTemplate?.regions ?? []);
  const [activeField,    setActiveField]    = useState<FieldId>("roNumber");
  const [ghostBox,       setGhostBox]       = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [templateName,   setTemplateName]   = useState(initialTemplate?.name ?? "");
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
      const id = initialTemplate?.id ?? crypto.randomUUID();
      const name = templateName.trim() || "Page 1";
      // storagePath mirrors what the server will compute, so we can pass it to onClose.
      const storagePath = initialTemplate?.imageStoragePath ?? `${userId}/template_${id}`;

      const fd = new FormData();
      fd.append("id", id);
      fd.append("name", name);
      if (imageFile) fd.append("image", imageFile);
      if (initialTemplate?.imageStoragePath) {
        fd.append("existingStoragePath", initialTemplate.imageStoragePath);
      }
      fd.append("regions", JSON.stringify(regions));

      const res = await saveRoTemplateMetadata(fd);
      if ("error" in res) {
        setErrorMsg(res.error);
        return;
      }
      onClose({ id, name, imageStoragePath: storagePath, regions });
    } catch (err) {
      setErrorMsg(actionErrorMessage(err, "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canSave = !!imageObjectUrl && regions.length > 0 && !saving;

  return (
    // Renders through the shared Modal so it gets role="dialog", aria-modal,
    // an accessible name, Escape-to-close, a focus trap, focus restore and a
    // background scroll lock. onClose is wrapped: Modal's ✕ passes its click
    // event to onClose, which our (saved?: RoTemplate) signature would read as
    // a saved template.
    <Modal
      open
      onClose={() => onClose()}
      title="RO Template Setup"
      size="xl"
      footer={
        <>
          <div className="log-status">
            <b>{regions.length} / {FIELD_ORDER.length} fields mapped</b>
          </div>
          <div className="tpl-foot-act">
            <Button variant="quiet" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button variant="go" onClick={handleSave} disabled={!canSave}>
              {saving ? "Saving…" : "Save Template"}
            </Button>
          </div>
        </>
      }
    >
      <div className="tpl-body">

        <p className="tpl-lede">
          Upload a sample RO, pick a field, then drag on the image to mark where it appears.
          The scanner will only read those regions — much more accurate than scanning the whole page.
        </p>

        {/* Template name */}
        <Field label="Template name" htmlFor="template-name">
          <input
            id="template-name"
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. Page 1, Page 2, Walk-around…"
            className="input"
          />
        </Field>

        {/* Field selector */}
        <div className="fchips tpl-chips">
          {FIELD_ORDER.map((field) => {
            const cfg = FIELDS[field];
            const mapped = regions.some((r) => r.field === field);
            const active = activeField === field;
            return (
              <button
                key={field}
                onClick={() => setActiveField(field)}
                aria-pressed={active}
                className={`fchip ${cfg.hue}`}
              >
                <span className="hue" aria-hidden="true" />
                {mapped && <CheckCircle className="tpl-chip-ok" aria-hidden="true" />}
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Image area */}
        {!imageObjectUrl ? (
          <div className="card-inset tpl-drop">
            {loadingImg ? (
              <Loader2 className="tpl-spin" aria-label="Loading image" />
            ) : (
              <>
                <Upload className="tpl-drop-ico" aria-hidden="true" />
                <p className="tpl-drop-title">Upload a photo of your shop&apos;s RO</p>
                <p className="tpl-drop-sub">JPEG · PNG · WEBP</p>
                <Button variant="line" onClick={() => fileInputRef.current?.click()}>
                  Choose a photo
                </Button>
              </>
            )}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="tpl-canvas"
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
              className="tpl-img"
            />

            {/* Existing boxes */}
            {regions.map((r) => {
              const cfg = FIELDS[r.field];
              return (
                <div
                  key={r.field}
                  className={`tpl-box ${cfg.hue}`}
                  style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
                >
                  {/* Label */}
                  <div className="tpl-box-label">{cfg.label}</div>
                  {/* Corner resize handles */}
                  <div className="tpl-handle tpl-nw" />
                  <div className="tpl-handle tpl-ne" />
                  <div className="tpl-handle tpl-sw" />
                  <div className="tpl-handle tpl-se" />
                  {/* Delete button */}
                  <button
                    className="tpl-box-x"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRegions((prev) => prev.filter((reg) => reg.field !== r.field));
                    }}
                    aria-label={`Remove ${cfg.label} box`}
                  >
                    <X className="tpl-box-x-ico" />
                  </button>
                </div>
              );
            })}

            {/* Ghost box while drawing */}
            {ghostBox && (
              <div
                className={`tpl-box tpl-ghost ${FIELDS[activeField].hue}`}
                style={{ left: `${ghostBox.x}%`, top: `${ghostBox.y}%`, width: `${ghostBox.w}%`, height: `${ghostBox.h}%` }}
              />
            )}
          </div>
        )}

        {/* Hints + image change link */}
        {imageObjectUrl && (
          <StatusField tag="Note" inset>
            Pick a field above, then <strong>drag</strong> on the image to draw a box.
            Drag a box to move it · drag its corners to resize it · red ✕ to delete.{" "}
            <button className="tpl-change" onClick={() => fileInputRef.current?.click()}>
              Change image
            </button>
          </StatusField>
        )}

        <label htmlFor="ro-template-file" className="sr-only">Upload RO template image</label>
        <input
          ref={fileInputRef}
          id="ro-template-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby={errorMsg ? "ro-template-error" : undefined}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageFile(f);
            e.target.value = "";
          }}
        />

        {errorMsg && (
          <StatusField tag="Fix" role="alert" inset id="ro-template-error">
            {errorMsg}
          </StatusField>
        )}
      </div>
    </Modal>
  );
}
