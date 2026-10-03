"use client";

// Admin feature request inbox. Same shape as BugInbox (and the same adm-/inb-
// styles): a filterable list, click one for a detail modal with the full text,
// where it came from, and the review controls. No hard delete — "Not Planned"
// closes a request and keeps the history.
import { useMemo, useState, useTransition } from "react";
import type { FeatureRequest, SubmissionReply, Submitter } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Zone } from "@/components/ui/Zone";
import { StatusField } from "@/components/ui/StatusField";
import { EmptyState } from "@/components/ui/EmptyState";
import { CLOSED_FEATURE_STATUSES, FEATURE_STATUSES } from "@/lib/feature-requests";
import { setFeatureReview } from "@/app/actions/feature-requests";
import { actionErrorMessage } from "@/lib/action-error";
import { ReplyPanel, submitterName } from "./ReplyPanel";

type BadgeTone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "New":
      return "info";
    case "Shipped":
      return "good";
    case "Not Planned":
      return "neutral";
    default:
      return "brand"; // Reviewing, Planned, In Progress
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

export function FeatureInbox({
  initialRequests,
  submitters,
  initialReplies,
}: {
  initialRequests: FeatureRequest[];
  submitters: Record<string, Submitter>;
  initialReplies: SubmissionReply[];
}) {
  const [requests, setRequests] = useState<FeatureRequest[]>(initialRequests);
  const [replies, setReplies] = useState<SubmissionReply[]>(initialReplies);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter === "open") return !(CLOSED_FEATURE_STATUSES as readonly string[]).includes(r.status);
      if (statusFilter === "all") return true;
      return r.status === statusFilter;
    });
  }, [requests, statusFilter]);

  const selected = selectedId ? requests.find((r) => r.id === selectedId) ?? null : null;

  function handleSaved(updated: FeatureRequest) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="adm-inbox">
      <div className="adm-filters">
        <Field label="Status" htmlFor="filter-feature-status" className="adm-filter">
          <Select
            id="filter-feature-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Open (default)</option>
            <option value="all">All</option>
            {FEATURE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Zone
        name="Requests"
        aside={`${filtered.length} ${filtered.length === 1 ? "request" : "requests"}`}
      >
        {filtered.length === 0 ? (
          <EmptyState title="Nothing here" description="No requests match this filter." />
        ) : (
          <div className="adm-list">
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="rowbtn adm-row"
              >
                <span>
                  <span className="adm-title">{r.description}</span>
                  <span className="adm-meta">
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    <span className="adm-date">{formatDate(r.createdAt)}</span>
                    <span className="adm-from">from {submitterName(submitters[r.userId])}</span>
                  </span>
                </span>
                <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </Zone>

      {selected && (
        <FeatureDetail
          request={selected}
          submitter={submitters[selected.userId]}
          replies={replies.filter((r) => r.featureRequestId === selected.id)}
          onReplySent={(reply) => setReplies((prev) => [...prev, reply])}
          onClose={() => setSelectedId(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FeatureDetail({
  request,
  submitter,
  replies,
  onReplySent,
  onClose,
  onSaved,
}: {
  request: FeatureRequest;
  submitter: Submitter | undefined;
  replies: SubmissionReply[];
  onReplySent: (reply: SubmissionReply) => void;
  onClose: () => void;
  onSaved: (updated: FeatureRequest) => void;
}) {
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.adminNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirty = status !== request.status || notes !== (request.adminNotes ?? "");

  // Don't let a backdrop/Escape/X dismiss discard an in-flight save.
  function handleClose() {
    if (saving) return;
    onClose();
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      try {
        await setFeatureReview(request.id, { status, adminNotes: notes });
        onSaved({
          ...request,
          status,
          adminNotes: notes.trim() || null,
          updatedAt: new Date().toISOString(),
        });
        onClose();
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save. Try again."));
      }
    });
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title="Feature request"
      size="lg"
      footer={
        <>
          <Button variant="quiet" onClick={handleClose} disabled={saving}>
            Close
          </Button>
          <Button
            variant="go"
            className="inb-save"
            onClick={handleSave}
            disabled={saving || !dirty}
            busy={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="inb-body">
        <section>
          <div className="field-label">Request</div>
          <div className="card-inset inb-desc">{request.description}</div>
        </section>

        <section>
          <div className="field-label">Context</div>
          <dl className="rows inb-ctx">
            <ContextRow label="From" value={submitterName(submitter)} />
            <ContextRow label="Email" value={submitter?.email ?? null} mono />
            <ContextRow label="Sent" value={formatDate(request.createdAt)} />
            <ContextRow label="Page" value={request.pageUrl} mono />
            <ContextRow label="Build" value={request.appBuild} mono />
          </dl>
        </section>

        <section className="inb-triage">
          <div className="field-label">Review</div>
          <div className="inb-triage-grid">
            <Field label="Status" htmlFor="feature-status">
              <Select id="feature-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {FEATURE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="feature-notes">
            <Textarea
              id="feature-notes"
              rows={3}
              placeholder="How it'd work, what it touches, why yes or why not…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </section>

        {error && (
          <StatusField tag="Fix" role="alert" inset>
            {error}
          </StatusField>
        )}

        <ReplyPanel
          source="feature"
          submissionId={request.id}
          savedStatus={request.status}
          submitter={submitter}
          replies={replies}
          onSent={onReplySent}
        />
      </div>
    </Modal>
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
    <div className="inb-ctx-row">
      <dt className="k">{label}</dt>
      <dd className={`v${mono ? " inb-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
