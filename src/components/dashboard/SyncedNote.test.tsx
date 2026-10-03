// @vitest-environment jsdom
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SyncedNote, GuestSyncedNote, syncedLabel } from "./SyncedNote";

describe("syncedLabel", () => {
  const t0 = Date.UTC(2026, 9, 2, 12, 0, 0);
  const at = (ms: number) => syncedLabel(t0, t0 + ms);
  it("reads just now under a minute", () => {
    expect(at(0)).toBe("synced just now");
    expect(at(59_000)).toBe("synced just now");
    expect(syncedLabel(t0, t0 - 5_000)).toBe("synced just now"); // clock skew
  });
  it("counts minutes", () => {
    expect(at(60_000)).toBe("synced 1 min ago");
    expect(at(14 * 60_000 + 5_000)).toBe("synced 14 min ago");
    expect(at(59 * 60_000)).toBe("synced 59 min ago");
  });
  it("counts hours and days", () => {
    expect(at(60 * 60_000)).toBe("synced 1 hr ago");
    expect(at(2 * 60 * 60_000 + 60_000)).toBe("synced 2 hr ago");
    expect(at(24 * 60 * 60_000)).toBe("synced 1 day ago");
  });
});

describe("SyncedNote", () => {
  afterEach(() => vi.useRealTimers());

  it("starts at just now and ticks forward", () => {
    vi.useFakeTimers();
    const fetchedAt = new Date().toISOString();
    render(<SyncedNote fetchedAt={fetchedAt} />);
    expect(screen.getByText("synced just now")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByText("synced 3 min ago")).toBeTruthy();
  });

  it("ignores server/browser clock skew: an old-looking fetchedAt still starts at just now", () => {
    // Fixture mode pins the server clock months back; a skewed phone clock
    // must not read as staleness either.
    const skewed = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const { container } = render(<SyncedNote fetchedAt={skewed} />);
    expect(container.textContent).toBe("synced just now");
  });

  it("a remount with the same fetchedAt keeps counting from first sight", () => {
    vi.useFakeTimers();
    const fetchedAt = "2026-10-02T12:00:00.000Z#remount";
    const first = render(<SyncedNote fetchedAt={fetchedAt} />);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    first.unmount();
    const { container } = render(<SyncedNote fetchedAt={fetchedAt} />);
    expect(container.textContent).toBe("synced 5 min ago");
  });
});

describe("GuestSyncedNote", () => {
  it("says the data is local", () => {
    render(<GuestSyncedNote />);
    expect(screen.getByText("on this phone only")).toBeTruthy();
  });
});
