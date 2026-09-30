// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppearanceCard } from "./AppearanceCard";

const saveAppearance = vi.fn<(a: { theme: string; accent: string }) => Promise<{ error?: string }>>();
vi.mock("@/app/actions/appearance", () => ({
  saveAppearance: (a: { theme: string; accent: string }) => saveAppearance(a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  saveAppearance.mockResolvedValue({});
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
});
afterEach(cleanup);

describe("AppearanceCard", () => {
  it("renders every option with the initial selection checked", () => {
    render(<AppearanceCard initialTheme="dark-graphite" initialAccent="teal" mode="account" />);
    expect(screen.getAllByRole("radio")).toHaveLength(9);
    expect((screen.getByRole("radio", { name: /Graphite/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Teal/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Accent colour" })).toBeTruthy();
  });

  it("applies instantly to the root and localStorage, and saves in account mode", async () => {
    render(<AppearanceCard initialTheme="dark" initialAccent="blue" mode="account" />);
    fireEvent.click(screen.getByRole("radio", { name: /Pitch/ }));
    expect(document.documentElement.dataset.theme).toBe("dark-pitch");
    expect(window.localStorage.getItem("theme")).toBe("dark-pitch");
    await waitFor(() => expect(saveAppearance).toHaveBeenCalledWith({ theme: "dark-pitch", accent: "blue" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Saved.*Pitch.*your account/);

    fireEvent.click(screen.getByRole("radio", { name: /Orange/ }));
    expect(document.documentElement.dataset.accent).toBe("orange");
    expect(window.localStorage.getItem("accent")).toBe("orange");
    await waitFor(() => expect(saveAppearance).toHaveBeenLastCalledWith({ theme: "dark-pitch", accent: "orange" }));
  });

  it("shows the refusal and keeps the local look", async () => {
    saveAppearance.mockResolvedValue({ error: "Not signed in" });
    render(<AppearanceCard initialTheme="dark" initialAccent="blue" mode="account" />);
    fireEvent.click(screen.getByRole("radio", { name: /Light/ }));
    const status = await screen.findByText(/not saved to your account: Not signed in/);
    expect(status.closest("[role=status]")?.textContent).toMatch(/Fix/);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("guest mode stays in the browser and never calls the action", () => {
    render(<AppearanceCard initialTheme="dark" initialAccent="blue" mode="guest" compact />);
    fireEvent.click(screen.getByRole("radio", { name: /Ink/ }));
    expect(saveAppearance).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("accent")).toBe("ink");
    expect(screen.getByRole("status").textContent).toMatch(/this browser/);
  });
});
