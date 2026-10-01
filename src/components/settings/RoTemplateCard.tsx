"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRoTemplateAction } from "@/app/actions/ro-template";
import { RoTemplateEditor } from "./RoTemplateEditor";
import type { RoTemplate } from "@/lib/types";
import { actionErrorMessage } from "@/lib/action-error";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SettingRow } from "./SettingRow";

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
        setDeleteError(actionErrorMessage(err, "Couldn't delete — check your connection and try again."));
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <>
      <SettingRow
        titleAs="h2"
        title="RO Scan Templates"
        wide
        description="Mark where each field lives on your RO so the scanner knows exactly where to look. Add one template per page layout."
      >
        <div className="stg-actions" style={{ marginTop: 0 }}>
          <Button variant="line" onClick={openNew}>
            <Plus size={16} aria-hidden="true" />
            Add Template
          </Button>
        </div>

        {templates.length === 0 ? (
          <>
            <p className="stg-fine">
              No templates yet. Without one, the scanner tries to read the entire page and often misses fields.
            </p>
            <p className="stg-fine"><b>How to set up scanning — 3 steps:</b></p>
            <ol className="stg-steps">
              <li>
                <span>Click <b>&quot;Add Template&quot;</b> above, give it a name (e.g. your shop&apos;s RO form), then upload a clear photo of a blank RO.</span>
              </li>
              <li>
                <span>Draw boxes around each field you want scanned — RO number, vehicle info, VIN, and op codes. The scanner will only look inside those boxes.</span>
              </li>
              <li>
                <span>Go to <b>Log RO</b> and tap <b>&quot;Scan RO&quot;</b>. Point your camera at the RO and the form auto-fills.</span>
              </li>
            </ol>
          </>
        ) : (
          <ul className="stg-templates">
            {templates.map((t) => (
              <li key={t.id}>
                <div className="stg-template-head">
                  <b>{t.name}</b>
                  <div className="stg-template-acts">
                    <Button variant="quiet" size="sm" onClick={() => openEdit(t)}>
                      <Pencil size={14} aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="stg-template-fields">
                  {t.regions.map((r) => (
                    <Badge key={r.field} tone="good">
                      ✓ {FIELD_LABELS[r.field] ?? r.field}
                    </Badge>
                  ))}
                  {(["roNumber", "vehicle", "vin", "opCodes"] as const)
                    .filter((f) => !t.regions.some((r) => r.field === f))
                    .map((f) => (
                      <Badge key={f} chip>
                        {FIELD_LABELS[f]}
                      </Badge>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {deleteError && (
          <p role="alert" className="stg-note is-bad">{deleteError}</p>
        )}
      </SettingRow>

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
