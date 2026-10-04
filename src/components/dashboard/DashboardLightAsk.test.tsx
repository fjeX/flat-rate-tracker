// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { DashboardLightAsk } from "./DashboardLightAsk";
import { lightRetroChips, type LightRetroCandidate } from "@/lib/retro-capture";

const replace = vi.fn();
let search = "ask=line-1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(search),
}));

const setLineActualHoursAction = vi.fn(
  async (...a: unknown[]): Promise<{ error?: string; skipped?: boolean }> => (void a, {}),
);
vi.mock("@/app/actions/entries", () => ({
  setLineActualHoursAction: (...a: unknown[]) => setLineActualHoursAction(...a),
}));

const candidate: LightRetroCandidate = {
  lineId: "line-1",
  code: "ALIGN",
  description: "Alignment",
  flagHours: 1.5,
  chips: lightRetroChips(1.5),
};

beforeEach(() => {
  vi.clearAllMocks();
  search = "ask=line-1";
});
afterEach(() => vi.useRealTimers());

function skipBtn() {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Skip",
  ) as HTMLButtonElement;
}
function chip() {
  return document.querySelector("button.log-chip") as HTMLButtonElement;
}

describe("DashboardLightAsk", () => {
  it("asks with the line's code and touches nothing on render", () => {
    render(<DashboardLightAsk candidate={candidate} />);
    expect(screen.getByText("How long did the ALIGN take?")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders nothing when it never had a candidate", () => {
    const { container } = render(<DashboardLightAsk candidate={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("a chip tap writes a guarded estimate, then the router drops ?ask=", async () => {
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      chip().click();
    });
    const [lineId, hours, source, opts] = setLineActualHoursAction.mock.calls[0];
    expect(lineId).toBe("line-1");
    expect(source).toBe("estimate");
    expect(opts).toEqual({ onlyIfEmpty: true });
    expect(screen.getByText(new RegExp(`^Saved ${hours}h for ALIGN$`))).toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });

  it("keeps other params when removing ask", async () => {
    search = "tab=week&ask=line-1&x=1";
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      skipBtn().click();
    });
    expect(replace).toHaveBeenCalledWith("/dashboard?tab=week&x=1", { scroll: false });
  });

  it("LATCH: the confirmation survives the page re-rendering the prop to null", async () => {
    const { rerender } = render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      chip().click();
    });
    // The write revalidated /dashboard; the line is now timed, so the server
    // resolves no candidate.
    rerender(<DashboardLightAsk candidate={null} />);
    expect(screen.getByText(/^Saved .*h for ALIGN$/)).toBeTruthy();
  });

  it("the confirmation goes away by itself", async () => {
    vi.useFakeTimers();
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      chip().click();
    });
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(/^Saved/)).toBeNull();
  });

  it("Skip removes the row, writes nothing, and the router drops ?ask=", async () => {
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      skipBtn().click();
    });
    expect(screen.queryByText(/How long did/)).toBeNull();
    expect(setLineActualHoursAction).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });

  it("a skipped write (line already timed) closes quietly, with no confirmation", async () => {
    setLineActualHoursAction.mockResolvedValueOnce({ skipped: true });
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      chip().click();
    });
    expect(screen.queryByText(/How long did/)).toBeNull();
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("a failed write closes the row and still drops ?ask=", async () => {
    setLineActualHoursAction.mockRejectedValueOnce(new Error("boom"));
    render(<DashboardLightAsk candidate={candidate} />);
    await act(async () => {
      chip().click();
    });
    expect(screen.queryByText(/How long did/)).toBeNull();
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
