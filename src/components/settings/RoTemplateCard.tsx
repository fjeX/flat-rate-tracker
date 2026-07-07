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
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    setDeleteError(null);
    startDelete(async () => {
      try {
        await deleteRoTemplateAction(templateId);
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Couldn't delete — check your connection and try again.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <>
      <div className="card padded">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Camera className="h-5 w-5 flex-shrink-0" style={{ color: "var(--brand)" }} />
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--fg-0)" }}>RO Scan Templates</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--fg-2)" }}>
                Mark where each field lives on your RO so the scanner knows exactly where to look.
                Add one template per page layout.
              </p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="btn btn-sm flex-shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs" style={{ color: "var(--fg-3)" }}>
              No templates yet. Without one, the scanner tries to read the entire page and often misses fields.
            </p>
            <div>
              <p className="mb-2 text-xs font-medium" style={{ color: "var(--fg-2)" }}>How to set up scanning — 3 steps:</p>
              <ol className="space-y-2 text-xs" style={{ color: "var(--fg-3)" }}>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono" style={{ color: "var(--brand)" }}>1.</span>
                  <span>Click <span style={{ color: "var(--fg-1)" }}>&quot;Add Template&quot;</span> above, give it a name (e.g. your shop&apos;s RO form), then upload a clear photo of a blank RO.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono" style={{ color: "var(--brand)" }}>2.</span>
                  <span>Draw boxes around each field you want scanned — RO number, vehicle info, VIN, and op codes. The scanner will only look inside those boxes.</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 font-mono" style={{ color: "var(--brand)" }}>3.</span>
                  <span>Go to <span style={{ color: "var(--fg-1)" }}>Log RO</span> and tap <span style={{ color: "var(--fg-1)" }}>&quot;Scan RO&quot;</span>. Point your camera at the RO and the form auto-fills.</span>
                </li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium" style={{ color: "var(--fg-1)" }}>{t.name}</span>
                  <div className="flex gap-3 flex-shrink-0">
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                      className="btn btn-sm"
                      style={{ color: "var(--bad)", minHeight: 44, minWidth: 44 }}
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                    <button
                      onClick={() => openEdit(t)}
                      className="btn btn-sm"
                      style={{ minHeight: 44, minWidth: 44 }}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.regions.map((r) => (
                    <span key={r.field} className="pill">
                      ✓ {FIELD_LABELS[r.field] ?? r.field}
                    </span>
                  ))}
                  {(["roNumber", "vehicle", "vin", "opCodes"] as const)
                    .filter((f) => !t.regions.some((r) => r.field === f))
                    .map((f) => (
                      <span key={f} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--line)", color: "var(--fg-3)" }}>
                        {FIELD_LABELS[f]}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {deleteError && (
          <p role="alert" className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{deleteError}</p>
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
