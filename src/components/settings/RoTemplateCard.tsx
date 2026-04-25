"use client";

import { useState, useTransition } from "react";
import { Camera, Pencil, Trash2 } from "lucide-react";
import { deleteRoTemplateAction } from "@/app/actions/ro-template";
import { RoTemplateEditor } from "./RoTemplateEditor";
import type { RoTemplate } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  roNumber: "RO Number",
  vehicle:  "Year / Make / Model",
  vin:      "VIN",
  opCodes:  "Op Codes",
};

export function RoTemplateCard({
  userId,
  initialTemplate,
}: {
  userId: string;
  initialTemplate: RoTemplate | null;
}) {
  const [template, setTemplate] = useState<RoTemplate | null>(initialTemplate);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleEditorClose() {
    // The server action revalidates /settings, so the page will re-fetch the
    // updated template. Optimistically close — the card will show the saved
    // state after the next navigation or revalidation.
    setEditorOpen(false);
  }

  function handleDelete() {
    if (!confirm("Delete the RO template? The scanner will fall back to full-image mode.")) return;
    startDelete(async () => {
      await deleteRoTemplateAction();
      setTemplate(null);
    });
  }

  return (
    <>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Camera className="h-5 w-5 text-orange-400 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">RO Scan Template</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Mark where each field lives on your shop&apos;s RO so the scanner knows exactly where to look.
              </p>
            </div>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            {template && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-red-800 hover:text-red-400 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
            <button
              onClick={() => setEditorOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {template ? (
                <><Pencil className="h-3.5 w-3.5" /> Edit</>
              ) : (
                <><Camera className="h-3.5 w-3.5" /> Set Up Template</>
              )}
            </button>
          </div>
        </div>

        {template ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {template.regions.map((r) => (
              <span
                key={r.field}
                className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-300"
              >
                ✓ {FIELD_LABELS[r.field] ?? r.field}
              </span>
            ))}
            {(["roNumber", "vehicle", "vin", "opCodes"] as const)
              .filter((f) => !template.regions.some((r) => r.field === f))
              .map((f) => (
                <span key={f} className="rounded-full border border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-600">
                  {FIELD_LABELS[f]}
                </span>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            No template set. The scanner will try to read the entire page, which can miss fields on unfamiliar RO layouts.
          </p>
        )}
      </div>

      {editorOpen && (
        <RoTemplateEditor
          userId={userId}
          initialTemplate={template}
          onClose={handleEditorClose}
        />
      )}
    </>
  );
}
