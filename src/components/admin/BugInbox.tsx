"use client";

// Admin bug inbox. A filterable list of reports; click one to open a detail modal
// with the full description, the silently-captured context, the screenshots, and
// the triage controls. No hard delete — disposal is via the Resolved / Won't Fix
// statuses, so the history stays intact.
import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { Loader2, ImageIcon, X } from "lucide-react";
import type { BugReport } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { BUG_SEVERITIES, BUG_CATEGORIES, BUG_STATUSES } from "@/lib/bug-reports";
import { listBugPhotosWithUrls, setBugTriage } from "@/app/actions/bug-reports";

const CLOSED_STATUSES = ["Resolved", "Won't Fix"];

type BadgeTone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";

function severityTone(sev: string | null): BadgeTone {
  if (sev === "Critical") return "bad";
  if (sev === "High") return "warn";
  return "neutral";
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "New":
      return "info";
    case "Verify":
    case "Needs Info":
      return "warn";
    case "Resolved":
      return "good";
    case "Won't Fix":
      return "neutral";
    default:
      return "brand"; // Triaged, Investigating, Fix Proposed
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

export function BugInbox({ initialReports }: { initialReports: BugReport[] }) {
  const [reports, setReports] = useState<BugReport[]>(initialReports);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter === "open" && CLOSED_STATUSES.includes(r.status)) return false;
      if (statusFilter !== "open" && statusFilter !== "all" && r.status !== statusFilter)
        return false;
      if (severityFilter !== "all" && (r.severity ?? "") !== severityFilter) return false;
      return true;
    });
  }, [reports, statusFilter, severityFilter]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  function handleSaved(updated: BugReport) {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status" htmlFor="filter-status" className="min-w-[160px]">
          <Select
            id="filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Open (default)</option>
            <option value="all">All</option>
            {BUG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity" htmlFor="filter-severity" className="min-w-[140px]">
          <Select
            id="filter-severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="all">All</option>
            {BUG_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="">Untriaged</option>
          </Select>
        </Field>
        <span className="pb-2 text-sm text-[var(--fg-3)]">
          {filtered.length} {filtered.length === 1 ? "report" : "reports"}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState title="Nothing here" description="No reports match these filters." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="card flex items-center gap-3 p-3 text-left transition-colors hover:border-[var(--brand-soft)]"
            >
              <div className="flex shrink-0 flex-col items-start gap-1">
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                {r.severity && <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--fg-0)]">{r.description}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--fg-3)]">
                  <span>{formatDate(r.createdAt)}</span>
                  {r.category && <span>· {r.category}</span>}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <BugDetail
          report={selected}
          onClose={() => setSelectedId(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BugDetail({
  report,
  onClose,
  onSaved,
}: {
  report: BugReport;
  onClose: () => void;
  onSaved: (updated: BugReport) => void;
}) {
  const [severity, setSeverity] = useState(report.severity ?? "");
  const [category, setCategory] = useState(report.category ?? "");
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.triageNotes ?? "");
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [zoom, setZoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBugPhotosWithUrls(report.id);
        if (!cancelled) setPhotos(list);
      } catch {
        // Non-fatal — just no thumbnails.
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report.id]);

  const dirty =
    severity !== (report.severity ?? "") ||
    category !== (report.category ?? "") ||
    status !== report.status ||
    notes !== (report.triageNotes ?? "");

  // Don't let a backdrop/Escape/X dismiss discard an in-flight save.
  function handleClose() {
    if (saving) return;
    onClose();
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      try {
        await setBugTriage(report.id, { severity, category, status, triageNotes: notes });
        onSaved({
          ...report,
          severity: severity || null,
          category: category || null,
          status,
          triageNotes: notes.trim() || null,
          updatedAt: new Date().toISOString(),
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      }
    });
  }

  return (
    <Modal open onClose={handleClose} title="Bug report" wide>
      <div className="flex flex-col gap-5">
        {/* Description */}
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-[var(--fg-3)]">Description</div>
          <p className="whitespace-pre-wrap text-sm text-[var(--fg-0)]">{report.description}</p>
        </div>

        {/* Screenshots */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Screenshots
          </div>
          {photosLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--fg-3)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : photos.length === 0 ? (
            <p className="text-xs text-[var(--fg-3)]">None attached.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setZoom(p.url)}
                  aria-label={`View screenshot ${i + 1} of ${photos.length}`}
                  className="h-20 w-20 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-3)] transition-colors hover:border-[var(--brand-soft)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={`Screenshot ${i + 1} of ${photos.length}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Auto-captured context */}
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-[var(--fg-3)]">Context</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <ContextRow label="Reported" value={formatDate(report.createdAt)} />
            <ContextRow label="Page" value={report.pageUrl} mono />
            <ContextRow label="Viewport" value={report.viewport} mono />
            <ContextRow label="Build" value={report.appBuild} mono />
            <ContextRow label="Browser" value={report.userAgent} mono />
          </dl>
        </div>

        {/* Triage controls */}
        <div className="card-inset flex flex-col gap-3 p-3">
          <div className="text-xs uppercase tracking-wide text-[var(--fg-3)]">Triage</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Severity" htmlFor="triage-severity">
              <Select
                id="triage-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="">—</option>
                {BUG_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" htmlFor="triage-category">
              <Select
                id="triage-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">—</option>
                {BUG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="triage-status">
              <Select id="triage-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {BUG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Triage notes" htmlFor="triage-notes">
            <Textarea
              id="triage-notes"
              rows={3}
              placeholder="Repro steps, root-cause hunch, links…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--bad)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={handleClose} disabled={saving}>
            Close
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save triage"
            )}
          </Button>
        </div>
      </div>

      {zoom && <ScreenshotZoom url={zoom} onClose={() => setZoom(null)} />}
    </Modal>
  );
}

// Full-size screenshot overlay. Own Escape handler (capture-phase + stopPropagation)
// so dismissing the zoom doesn't also close the triage modal underneath it; focus
// moves to the close button on open.
function ScreenshotZoom({ url, onClose }: { url: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot"
      className="fixed inset-0 z-[70] flex flex-col bg-[var(--overlay-scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex justify-end px-4 py-3">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close screenshot"
          className="grid h-11 w-11 place-items-center rounded-full text-[var(--overlay-fg)]/80 hover:bg-[var(--overlay-fg)]/10 hover:text-[var(--overlay-fg)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Screenshot, full size" className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

function ContextRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-[var(--fg-3)]">{label}</dt>
      <dd className={`min-w-0 break-words text-[var(--fg-1)] ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </dd>
    </>
  );
}
