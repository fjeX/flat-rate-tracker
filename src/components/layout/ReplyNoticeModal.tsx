"use client";

// The other end of the loop: when the admin replies to a bug report or feature
// request, the person who sent it sees the reply here, centred on screen, the
// next time they open the app. One at a time, oldest first. Any way of closing
// it (button, X, Escape, backdrop) counts as seen — it was read, and a notice
// that keeps coming back stops being a thank-you.
//
// Mounted once in the (app) layout, which doesn't remount across navigations,
// so the dismissed list in state outlives the layout's cached props.
import { useState } from "react";
import { Lightbulb, MessageSquare, Wrench } from "lucide-react";
import type { ReplyNotice } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { dismissReplyNotice } from "@/app/actions/submission-replies";

const SNIPPET_CHARS = 220;

function copyFor(n: ReplyNotice) {
  const isBug = n.bugReportId !== null;
  if (n.kind === "fixed") {
    return { title: "Your bug report got fixed", lead: "You helped fix FRT.", Mark: Wrench, origLabel: "You reported" };
  }
  if (n.kind === "shipped") {
    return { title: "Your idea made it in", lead: "Your request is live in the app.", Mark: Lightbulb, origLabel: "You asked for" };
  }
  return {
    title: isBug ? "A reply to your bug report" : "A reply to your feature request",
    lead: null,
    Mark: MessageSquare,
    origLabel: isBug ? "You reported" : "You asked for",
  };
}

export function ReplyNoticeModal({ notices }: { notices: ReplyNotice[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const queue = notices.filter((n) => !dismissed.includes(n.id));
  const current = queue[0];
  if (!current) return null;

  function dismiss() {
    const id = current.id;
    setDismissed((prev) => [...prev, id]);
    // Fire-and-forget: if the write fails, the notice simply shows again next
    // visit — the safe direction for a message someone was meant to read.
    dismissReplyNotice(id).catch(() => {});
  }

  const { title, lead, Mark, origLabel } = copyFor(current);
  const more = queue.length - 1;
  const orig =
    current.originalText && current.originalText.length > SNIPPET_CHARS
      ? `${current.originalText.slice(0, SNIPPET_CHARS).trimEnd()}…`
      : current.originalText;

  return (
    <Modal
      key={current.id}
      open
      onClose={dismiss}
      title={title}
      placement="center"
      footer={
        <>
          {more > 0 && <span className="rn-count">{more} more</span>}
          <Button variant="go" className="rn-go" onClick={dismiss}>
            {more > 0 ? "Next" : "Thanks!"}
          </Button>
        </>
      }
    >
      <div className="rn-body">
        <span className="rn-mark" aria-hidden="true">
          <Mark className="ic" />
        </span>
        {lead && <p className="rn-lead">{lead}</p>}
        <p className="rn-msg">{current.message}</p>
        <p className="rn-sign">— Liem</p>
        {orig && (
          <div className="rn-orig">
            <div className="field-label">{origLabel}</div>
            <div className="card-inset">{orig}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
