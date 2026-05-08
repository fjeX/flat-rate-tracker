"use client";

import { useState, useTransition } from "react";
import { Camera, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRoTemplateAction } from "@/app/actions/ro-template";
import { RoTemplateEditor } from "./RoTemplateEditor";
import type { RoTemplate } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  roNumber: "RO Number",
  vehicle:  "Year / Make / Model",
  vin:      "VIN",
  opCodes:  "Op Codes",
};

type EditorState =
  | { open: false }
  | { open: true; template: RoTemplate | null };

export function RoTemplateCard({
  userId,
  initialTemplates,
}: {
  userId: string;
  initialTemplates: RoTemplate[];
}) {
  const [templates, setTemplates]   = useState<RoTemplate[]>(initialTemplates);
  const [editor, setEditor]         = useState<EditorState>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete]             = useTransition();

  function openNew() {
    setEditor({ open: true, template: null });
  }

  function openEdit(t: RoTemplate) {
    setEditor({ open: true, template: t });
  }

  function handleEditorClose(saved?: RoTemplate) {
    setEditor({ open: false });
    if (saved) {
      setTemplates((prev) => {
        const idx = prev.findIndex((t) => t.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
    }
  }

  function handleDelete(templateId: string) {
    if (!confirm("Delete this template? The scanner will no longer use it.")) return;
    setDeletingId(templateId);
    startDelete(async () => {
      await deleteRoTemplateAction(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      setDeletingId(null);
    });
  }

  return (
    <>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Camera className="h-5 w-5 text-orange-400 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">RO Scan Templates</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Mark where each field lives on your RO so the scanner knows exactly where to look.
                Add one template per page layout.
              </p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 flex-shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-zinc-500">
              No templates yet. Without one, the scanner tries to read the entire page and often misses fields.
            </p>
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-400">How to set up scanning — 3 steps:</p>
              <ol className="space-y-2 text-xs text-zinc-500">
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono text-orange-400">1.</span>
                  <span>Click <span className="text-zinc-300">&quot;Add Template&quot;</span> above, give it a name (e.g. your shop&apos;s RO form), then upload a clear photo of a blank RO.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono text-orange-400">2.</span>
                  <span>Draw boxes around each field you want scanned — RO number, vehicle info, VIN, and op codes. The scanner will only look inside those boxes.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono text-orange-400">3.</span>
                  <span>Go to <span className="text-zinc-300">Log RO</span> and tap <span className="text-zinc-300">&quot;Scan RO&quot;</span>. Point your camera at the RO and the form auto-fills.</span>
                </li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-zinc-200">{t.name}</span>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                      className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-red-800 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                    <button
                      onClick={() => openEdit(t)}
                      className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.regions.map((r) => (
                    <span key={r.field} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                      ✓ {FIELD_LABELS[r.field] ?? r.field}
                    </span>
                  ))}
                  {(["roNumber", "vehicle", "vin", "opCodes"] as const)
                    .filter((f) => !t.regions.some((r) => r.field === f))
                    .map((f) => (
                      <span key={f} className="rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-600">
                        {FIELD_LABELS[f]}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editor.open && (
        <RoTemplateEditor
          userId={userId}
          initialTemplate={editor.template}
          onClose={handleEditorClose}
        />
      )}
    </>
  );
}
