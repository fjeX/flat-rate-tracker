// @vitest-environment jsdom
//
// The Today zone: headline panel, Clocked field, Quick Add RO. Rebuilt from a
// stat tile whose whole top half was the Quick Add button; the button is its
// own control now, so what has to hold is that it still opens Quick Add, that
// Clocked still saves on blur and Enter, and that the second headline cell
// still switches between efficiency and live pace.
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { TodayCard } from "./TodayCard";
import type { OpCode } from "@/lib/types";

const upsert = vi.fn();
vi.mock("@/app/actions/daily-clock", () => ({
  upsertDailyClockHoursAction: (...args: unknown[]) => upsert(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => upsert.mockReset());
afterEach(cleanup);

const LIBRARY = [
  { id: "o1", code: "LOF", description: "", flagHours: 0.5, subOpCodes: [] },
] as unknown as OpCode[];

function stats(over: Record<string, unknown> = {}) {
  return {
    flagHours: 4,
    clockedHours: 0,
    efficiency: null,
    roCount: 2,
    actualHours: 0,
    unpaidHours: 0,
    comebackHours: 0,
    waitingHours: 0,
    shopHours: 0,
    upsellHours: 0,
    openTicketHours: 0,
    openTicketCount: 0,
    ...over,
  };
}

function renderCard(props: Record<string, unknown> = {}) {
  return render(
    <TodayCard
      date="2026-03-12"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stats={stats() as any}
      initialHours={0}
      library={LIBRARY}
      {...props}
    />,
  );
}

const clocked = () => screen.getByLabelText("Clocked hours today") as HTMLInputElement;

describe("TodayCard", () => {
  it("has a Quick Add RO button that opens Quick Add", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Quick Add RO" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("has no Quick Add button when there is no op-code library to add from", () => {
    renderCard({ library: [] });
    expect(screen.queryByRole("button", { name: "Quick Add RO" })).toBeNull();
    // the Clocked field is still there, on its own
    expect(clocked()).toBeTruthy();
  });

  it("saves Clocked on blur, once, with the parsed number", async () => {
    renderCard();
    fireEvent.change(clocked(), { target: { value: "8.5" } });
    fireEvent.blur(clocked());
    await waitFor(() => expect(upsert).toHaveBeenCalledWith("2026-03-12", 8.5));
    fireEvent.blur(clocked());
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter by blurring the field", async () => {
    renderCard();
    clocked().focus();
    fireEvent.change(clocked(), { target: { value: "7" } });
    fireEvent.keyDown(clocked(), { key: "Enter" });
    await waitFor(() => expect(upsert).toHaveBeenCalledWith("2026-03-12", 7));
  });

  it("does not save an unchanged field", () => {
    renderCard({ initialHours: 8 });
    fireEvent.blur(clocked());
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports a failed save as a Fix field, not a silent revert", async () => {
    upsert.mockRejectedValueOnce(new Error("nope"));
    renderCard();
    fireEvent.change(clocked(), { target: { value: "8" } });
    fireEvent.blur(clocked());
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector(".badge")?.textContent).toBe("Fix");
  });

  it("shows efficiency once clocked hours are in, coloured by state", () => {
    renderCard({ initialHours: 4 });
    const cell = document.querySelectorAll(".head-cell")[1];
    expect(cell.querySelector(".head-k")?.textContent).toBe("Efficiency");
    expect(cell.querySelector(".head-v")?.textContent).toBe("100%");
    expect(cell.querySelector(".is-good")).toBeTruthy();
    cleanup();
    renderCard({ initialHours: 8 });
    expect(document.querySelectorAll(".head-cell")[1].querySelector(".is-bad")).toBeTruthy();
  });

  it("shows a dash, uncoloured, when there is nothing to measure against", () => {
    renderCard();
    const cell = document.querySelectorAll(".head-cell")[1];
    expect(cell.querySelector(".head-v")?.textContent).toBe("—");
    expect(cell.querySelector(".is-good, .is-bad")).toBeNull();
  });

  it("adds the open-ticket line under the flag figure only when there are hours", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderCard({ stats: stats({ openTicketHours: 8, openTicketCount: 2 }) as any });
    expect(document.querySelector('[data-testid="open-ticket-line"]')?.textContent).toBe(
      "8.0h on 2 open tickets",
    );
    cleanup();
    renderCard();
    expect(document.querySelector('[data-testid="open-ticket-line"]')).toBeNull();
  });
});
