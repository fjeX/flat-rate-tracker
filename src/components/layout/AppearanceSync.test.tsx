// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { AppearanceSync } from "./AppearanceSync";
import { APPEARANCE_SYNCED_KEY } from "@/lib/appearance-sync";

const saveAppearance = vi.fn();
vi.mock("@/app/actions/appearance", () => ({
  saveAppearance: (...a: unknown[]) => saveAppearance(...a),
}));

const get = (k: string) => window.localStorage.getItem(k);

beforeEach(() => {
  saveAppearance.mockReset();
  saveAppearance.mockResolvedValue({});
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
});

describe("AppearanceSync", () => {
  it("first visit: writes the account values and the marker, and applies them", () => {
    window.localStorage.setItem("theme", "light");
    render(<AppearanceSync userId="u1" theme="dark-graphite" accent="teal" />);
    expect(get("theme")).toBe("dark-graphite");
    expect(get("accent")).toBe("teal");
    expect(get(APPEARANCE_SYNCED_KEY)).toBe("u1");
    expect(document.documentElement.dataset.theme).toBe("dark-graphite");
    expect(document.documentElement.dataset.accent).toBe("teal");
  });

  it("marker present for this user: no-op even when the values differ", () => {
    window.localStorage.setItem(APPEARANCE_SYNCED_KEY, "u1");
    window.localStorage.setItem("theme", "light");
    window.localStorage.setItem("accent", "red");
    render(<AppearanceSync userId="u1" theme="dark" accent="blue" />);
    expect(get("theme")).toBe("light");
    expect(get("accent")).toBe("red");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("marker for another user: overwrites and re-marks", () => {
    window.localStorage.setItem(APPEARANCE_SYNCED_KEY, "someone-else");
    window.localStorage.setItem("theme", "light");
    render(<AppearanceSync userId="u2" theme="dark-pitch" accent="ink" />);
    expect(get("theme")).toBe("dark-pitch");
    expect(get("accent")).toBe("ink");
    expect(get(APPEARANCE_SYNCED_KEY)).toBe("u2");
  });

  it("pre-existing account still at the defaults: saves the browser's choice UP instead of overwriting it", async () => {
    // A Light user from the old Account toggle must not be flipped to Dark.
    window.localStorage.setItem("theme", "light");
    render(<AppearanceSync userId="u1" theme="dark" accent="blue" />);
    expect(saveAppearance).toHaveBeenCalledWith({ theme: "light", accent: "blue" });
    expect(get("theme")).toBe("light");
    await waitFor(() => expect(get(APPEARANCE_SYNCED_KEY)).toBe("u1"));
  });

  it("save-up refused: keeps the browser's look and leaves the marker unset, so it retries", async () => {
    saveAppearance.mockResolvedValue({ error: "nope" });
    window.localStorage.setItem("theme", "light");
    render(<AppearanceSync userId="u1" theme="dark" accent="blue" />);
    await waitFor(() => expect(saveAppearance).toHaveBeenCalled());
    await Promise.resolve();
    expect(get("theme")).toBe("light");
    expect(get(APPEARANCE_SYNCED_KEY)).toBeNull();
  });

  it("both at the defaults: plain sync, no save", () => {
    render(<AppearanceSync userId="u1" theme="dark" accent="blue" />);
    expect(saveAppearance).not.toHaveBeenCalled();
    expect(get(APPEARANCE_SYNCED_KEY)).toBe("u1");
  });

  it("renders nothing", () => {
    const { container } = render(<AppearanceSync userId="u1" theme="dark" accent="blue" />);
    expect(container.innerHTML).toBe("");
  });
});
