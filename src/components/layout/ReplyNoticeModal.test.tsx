// @vitest-environment jsdom
//
// Pins the reply notice: the "your bug got fixed" moment a tech sees when the
// admin answers them. What matters is that it shows the right message, one at
// a time, centred, and that closing it in ANY way records it as seen — a
// thank-you that keeps coming back every page load is a nag.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplyNotice } from "@/lib/types";
import { __resetScrollLockForTests } from "@/components/ui/Modal";

const dismissReplyNotice = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
vi.mock("@/app/actions/submission-replies", () => ({
  dismissReplyNotice: (id: string) => dismissReplyNotice(id),
}));

import { ReplyNoticeModal } from "./ReplyNoticeModal";

function notice(overrides: Partial<ReplyNotice> = {}): ReplyNotice {
  return {
    id: "r1",
    userId: "u1",
    bugReportId: "b1",
    featureRequestId: null,
    kind: "fixed",
    message: "Fixed it, thanks!",
    createdAt: "2026-10-02T12:00:00Z",
    seenAt: null,
    originalText: "Save reset my hours to zero",
    ...overrides,
  };
}

beforeEach(() => {
  dismissReplyNotice.mockClear();
  __resetScrollLockForTests();
});

describe("ReplyNoticeModal", () => {
  it("renders nothing when there's nothing to say", () => {
    const { container } = render(<ReplyNoticeModal notices={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a fixed bug as a thank-you, centred, with what they reported", () => {
    render(<ReplyNoticeModal notices={[notice()]} />);
    const dialog = screen.getByRole("dialog", { name: "Your bug report got fixed" });
    expect(dialog.className).toContain("modal-center");
    expect(dialog.className).not.toContain("items-end");
    expect(screen.getByText("Fixed it, thanks!")).toBeTruthy();
    expect(screen.getByText("Save reset my hours to zero")).toBeTruthy();
  });

  it("titles a shipped request and a plain note differently", () => {
    const { unmount } = render(
      <ReplyNoticeModal
        notices={[notice({ kind: "shipped", bugReportId: null, featureRequestId: "f1" })]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Your idea made it in" })).toBeTruthy();
    unmount();
    render(
      <ReplyNoticeModal
        notices={[notice({ kind: "note", bugReportId: null, featureRequestId: "f1" })]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "A reply to your feature request" })).toBeTruthy();
  });

  it("walks the queue one at a time and marks each one seen", () => {
    render(
      <ReplyNoticeModal
        notices={[notice(), notice({ id: "r2", message: "Second one" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(dismissReplyNotice).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Second one")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thanks!" }));
    expect(dismissReplyNotice).toHaveBeenCalledWith("r2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("counts the X as seen too", () => {
    render(<ReplyNoticeModal notices={[notice()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dismissReplyNotice).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
