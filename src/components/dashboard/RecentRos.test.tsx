// @vitest-environment jsdom
//
// The dashboard's own Recent ROs list. It replaced RoList on this page, so the
// things RoList did for the dashboard have to be pinned here: tap the RO number
// for the detail dialog, the Upsell shortcut (dashboard only, and only when
// there is a library for the picker to show), the Open chip, date plus logged
// time, and the empty state.
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { RecentRos } from "./RecentRos";
import type { Entry, OpCode } from "@/lib/types";

// RoDetailModal pulls in server actions and the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const LIBRARY = [
  { id: "o1", code: "LOF", description: "", flagHours: 0.5, subOpCodes: [] },
] as unknown as OpCode[];

function entry(over: Record<string, unknown> = {}): Entry {
  return {
    id: "e1",
    userId: "u1",
    createdAt: "2026-03-11T20:00:00Z",
    updatedAt: "2026-03-11T20:00:00Z",
    date: "2026-03-11",
    roNumber: "909910086",
    vehicle: { year: 2017, make: "Ford", model: "F-150" },
    opCodes: [
      { id: "l1", opCodeId: "o1", custom: false, flagHours: 1, actualHours: null },
      { id: "l2", opCodeId: null, custom: true, customCode: "CUST", flagHours: 1.4, actualHours: 1.2 },
    ],
    flagHours: 2.4,
    notes: "",
    status: "closed",
    loggedTime: null,
    ...over,
  } as unknown as Entry;
}

describe("RecentRos", () => {
  it("shows the empty state with a way to log an RO", () => {
    render(<RecentRos jobTimings={[]} entries={[]} />);
    expect(screen.getByText("No ROs yet")).toBeTruthy();
    const link = screen.getByText(/Log an RO/);
    expect(link.closest("a")?.getAttribute("href")).toBe("/log");
  });

  it("links the zone to History", () => {
    render(<RecentRos jobTimings={[]} entries={[entry()]} library={LIBRARY} />);
    expect(screen.getByText("View all").closest("a")?.getAttribute("href")).toBe("/history");
  });

  it("prints the RO number, vehicle, hours and each op code as flag/actual", () => {
    render(<RecentRos jobTimings={[]} entries={[entry()]} library={LIBRARY} />);
    expect(screen.getByRole("button", { name: "RO 909910086" }).textContent).toBe("#909910086");
    expect(document.querySelector(".tag-veh")?.textContent).toBe("2017 Ford F-150");
    expect(document.querySelector(".tag-hrs")?.textContent).toBe("2.4h");
    const chips = Array.from(document.querySelectorAll(".ops li")).map((li) => li.textContent);
    // no actual hours recorded -> an em dash, not a zero
    expect(chips).toEqual(["LOF1.0/—", "CUST1.4/1.2"]);
  });

  it("draws one duration bar per RO, hidden from assistive tech", () => {
    render(<RecentRos jobTimings={[]} entries={[entry(), entry({ id: "e2", roNumber: "2" })]} library={LIBRARY} />);
    const bars = document.querySelectorAll(".dur");
    expect(bars.length).toBe(2);
    expect(bars[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the date and the logged time together when there is a time", () => {
    render(<RecentRos jobTimings={[]} entries={[entry({ loggedTime: "14:02" })]} library={LIBRARY} />);
    expect(document.querySelector(".tag-when")?.textContent).toMatch(/·\s*2:02\s*PM/);
  });

  it("shows the date alone when no time was recorded", () => {
    render(<RecentRos jobTimings={[]} entries={[entry()]} library={LIBRARY} />);
    expect(document.querySelector(".tag-when")?.textContent).not.toContain("·");
  });

  it("marks an open ticket with an Open tag", () => {
    render(<RecentRos jobTimings={[]} entries={[entry({ status: "open" })]} library={LIBRARY} />);
    expect(document.querySelector(".tag-head .badge")?.textContent).toBe("Open");
  });

  it("offers Upsell on every tag when there is a library", () => {
    render(<RecentRos jobTimings={[]} entries={[entry()]} library={LIBRARY} />);
    expect(screen.getByRole("button", { name: "Add an upsell to RO 909910086" })).toBeTruthy();
  });

  it("offers no Upsell without a library: the picker would open empty", () => {
    render(<RecentRos jobTimings={[]} entries={[entry()]} library={[]} />);
    expect(screen.queryByRole("button", { name: /upsell/i })).toBeNull();
  });
});
