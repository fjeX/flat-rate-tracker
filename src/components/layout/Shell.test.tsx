// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

let mockPath = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));
vi.mock("@/app/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/components/bug-report/ReportBugModal", () => ({ ReportBugModal: () => null }));

import { Header } from "./Header";
import { Nav } from "./Nav";
import { DirectoryDialog } from "./DirectoryDialog";
import { APP_ITEMS, APP_SUB } from "./nav-items";

beforeEach(() => {
  mockPath = "/dashboard";
});

describe("Nav", () => {
  it("rail lists every page and marks only the current one", () => {
    mockPath = "/log/new";
    render(<Nav />);
    const rail = screen.getByRole("navigation", { name: "Pages" });
    const links = within(rail).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(APP_ITEMS.map((i) => i.label));
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Log RO"]);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account" })).toBeTruthy();
  });

  it("bottom bar is the five thumb pages in the mock's order", () => {
    render(<Nav />);
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Dashboard",
      "Log RO",
      "Timer",
      "History",
      "Op Codes",
    ]);
  });

  it("shows the timer dot on the rail and the bottom bar only while running", () => {
    const { rerender } = render(<Nav timerRunning={false} />);
    expect(screen.queryAllByLabelText("Timer running")).toHaveLength(0);
    rerender(<Nav timerRunning />);
    expect(screen.getAllByLabelText("Timer running")).toHaveLength(2);
  });
});

describe("Header", () => {
  it("signed out is the logo alone", () => {
    render(<Header userEmail={null} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signed in has Pay Period and a directory button that opens every page", () => {
    render(<Header userEmail="a@b.c" />);
    expect(screen.getByRole("link", { name: "Pay Period" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Directory/ }));
    const dialog = screen.getByRole("dialog", { name: "Directory" });
    expect(within(dialog).getByRole("link", { name: "Insights" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("DirectoryDialog", () => {
  it("renders `extra` at the bottom of the body", () => {
    render(
      <DirectoryDialog open onClose={() => {}} items={APP_ITEMS} sub={APP_SUB} extra={<p>guest controls</p>} />,
    );
    expect(screen.getByText("guest controls")).toBeTruthy();
  });

  it("closes when a page link is followed", () => {
    const onClose = vi.fn();
    render(<DirectoryDialog open onClose={onClose} items={APP_ITEMS} />);
    const link = screen.getByRole("link", { name: "History" });
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });
});
