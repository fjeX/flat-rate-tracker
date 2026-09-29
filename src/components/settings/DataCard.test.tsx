// @vitest-environment jsdom
//
// import-error-text-masked: importDataAction now answers a refusal with
// { error } instead of throwing (a thrown message is masked in production).
// The card must show that sentence and must NOT fall through to "Import
// complete" — a caller that ignores the return value would tell the tech a
// refused backup succeeded.
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataCard } from "./DataCard";

const importDataAction = vi.fn();
vi.mock("@/app/actions/settings", () => ({
  exportDataAction: vi.fn(),
  importDataAction: (...a: unknown[]) => importDataAction(...a),
}));

const BACKUP = JSON.stringify({
  version: 5,
  exportedAt: "2026-09-01T00:00:00.000Z",
  settings: {},
  entries: [],
  opCodes: [],
  dailyClocks: [],
  paidPeriods: [],
  bonuses: [],
});

async function openConfirmDialog() {
  render(<DataCard />);
  const input = screen.getByLabelText("Import backup file") as HTMLInputElement;
  const file = new File([BACKUP], "backup.json", { type: "application/json" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  return screen.findByRole("button", { name: "Replace data" });
}

beforeEach(() => vi.clearAllMocks());

describe("DataCard import result handling", () => {
  it("renders the returned refusal sentence and no success message", async () => {
    importDataAction.mockResolvedValue({ error: "Invalid date in clock record." });
    const confirm = await openConfirmDialog();

    await act(async () => {
      fireEvent.click(confirm);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid date in clock record.");
    expect(screen.queryByText(/Import complete/)).toBeNull();
    // Dialog stays open so the tech can cancel or pick another file.
    expect(screen.getByText("Replace all data?")).toBeTruthy();
  });

  it("shows success and closes the dialog on {}", async () => {
    importDataAction.mockResolvedValue({});
    const confirm = await openConfirmDialog();

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(screen.getByText(/Import complete/)).toBeTruthy());
    expect(screen.queryByText("Replace all data?")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still surfaces a thrown failure through the catch", async () => {
    importDataAction.mockRejectedValue(new Error("network down"));
    const confirm = await openConfirmDialog();

    await act(async () => {
      fireEvent.click(confirm);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("network down");
    expect(screen.queryByText(/Import complete/)).toBeNull();
  });

  it("clears a previous refusal when a new file is picked", async () => {
    importDataAction.mockResolvedValue({ error: "Invalid date in clock record." });
    const confirm = await openConfirmDialog();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid date in clock record.");

    // Pick a different file without closing the dialog.
    const input = screen.getByLabelText("Import backup file") as HTMLInputElement;
    const next = new File([BACKUP], "other.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [next] } });
    });

    await waitFor(() => expect(screen.queryByText("Invalid date in clock record.")).toBeNull());
    expect(screen.getByText("Replace all data?")).toBeTruthy();
  });
});

describe("DataCard refuses a file missing a core section before the dialog", () => {
  it("shows the refusal and never opens 'Replace all data?'", async () => {
    render(<DataCard />);
    const input = screen.getByLabelText("Import backup file") as HTMLInputElement;
    const raw = JSON.parse(BACKUP);
    delete raw.bonuses;
    const file = new File([JSON.stringify(raw)], "old.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "This backup is missing its spiffs & bonuses section, so nothing was imported — your current data is unchanged.",
    );
    expect(screen.queryByText("Replace all data?")).toBeNull();
    expect(screen.queryByText(/your current data is kept/)).toBeNull();
    expect(importDataAction).not.toHaveBeenCalled();
  });
});

describe("DataCard — v1 backup that predates spiffs", () => {
  it("opens the dialog and says spiffs will be cleared, not kept", async () => {
    render(<DataCard />);
    const input = screen.getByLabelText("Import backup file") as HTMLInputElement;
    const raw = { ...JSON.parse(BACKUP), version: 1 };
    delete raw.bonuses;
    const file = new File([JSON.stringify(raw)], "v1.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await screen.findByText("Replace all data?")).toBeTruthy();
    const li = screen.getByText(
      "Spiffs & bonuses — will be cleared (this backup predates spiffs)",
    );
    expect(li.tagName).toBe("LI");
    // Not listed under "kept".
    const keptList = screen.getByText(/your current data is kept/).nextElementSibling!;
    expect(keptList.textContent).not.toMatch(/Spiffs/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
