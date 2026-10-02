// The dispute actions' refusal contract (server-action-thrown-refusals-masked).
//
// A production Next.js build replaces the message of any error thrown out of
// a Server Action with a generic string + digest, so a refusal the tech is
// meant to READ — "Nothing to dispute in this period." — has to come back as
// DATA. Each action is checked both ways: a refusal resolves to { error }, and
// a genuine failure (a DB error, an invariant) still rejects. A test that only
// checked "the bad case is rejected" would pass against a throw too, which is
// exactly the regression this guards.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  getOpenDisputeSafe: vi.fn(),
  getSettings: vi.fn(),
  listEntries: vi.fn(),
  listOpCodes: vi.fn(),
  listLaborRates: vi.fn(),
  listEntryIdsWithPhotos: vi.fn(),
  createDispute: vi.fn(),
  listDisputes: vi.fn(),
  updateDispute: vi.fn(),
  deleteDispute: vi.fn(),
  setLinePaidHours: vi.fn(),
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __fake: true }),
}));
vi.mock("@/lib/db", () => db);

const {
  openDisputeAction,
  applyDisputeRecoveryAction,
  setDisputeStatusAction,
  recordDisputeOutcomeAction,
  deleteDisputeAction,
} = await import("./disputes");

const PERIOD = "2026-07-P2";
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.getOpenDisputeSafe.mockResolvedValue(null);
  db.getSettings.mockResolvedValue({ splitDay: 15, periodOverrides: {} });
  db.listEntries.mockResolvedValue([]);
  db.listOpCodes.mockResolvedValue([]);
  db.listLaborRates.mockResolvedValue([]);
  db.listEntryIdsWithPhotos.mockResolvedValue([]);
  db.listDisputes.mockResolvedValue([]);
});

describe("openDisputeAction", () => {
  it("returns { error } when the period has nothing short, and creates nothing", async () => {
    // No entries: the rebuilt pack has totalShortHours 0.
    await expect(openDisputeAction(PERIOD)).resolves.toEqual({
      error: "Nothing to dispute in this period.",
    });
    expect(db.createDispute).not.toHaveBeenCalled();
  });

  it("returns a validation refusal as { error }", async () => {
    const res = await openDisputeAction("july");
    expect("error" in res && typeof res.error === "string" && res.error).toBeTruthy();
    expect(db.getOpenDisputeSafe).not.toHaveBeenCalled();
  });

  it("hands back an existing live dispute unchanged (success shape preserved)", async () => {
    const existing = { id: ID, periodKey: PERIOD };
    db.getOpenDisputeSafe.mockResolvedValue(existing);
    await expect(openDisputeAction(PERIOD)).resolves.toBe(existing);
  });

  it("still throws a genuine failure", async () => {
    db.getOpenDisputeSafe.mockRejectedValue(new Error("db down"));
    await expect(openDisputeAction(PERIOD)).rejects.toThrow("db down");
  });
});

describe("applyDisputeRecoveryAction", () => {
  it("returns { error } when the claim no longer exists, and writes nothing", async () => {
    await expect(applyDisputeRecoveryAction(ID)).resolves.toEqual({
      error: "That claim no longer exists.",
    });
    expect(db.setLinePaidHours).not.toHaveBeenCalled();
  });

  it("keeps 'Unrecognized period' an invariant: it throws", async () => {
    db.listDisputes.mockResolvedValue([{ id: ID, periodKey: "not-a-period", lines: [] }]);
    await expect(applyDisputeRecoveryAction(ID)).rejects.toThrow(
      "Unrecognized period: not-a-period",
    );
  });

  it("still throws a genuine failure", async () => {
    db.listDisputes.mockRejectedValue(new Error("db down"));
    await expect(applyDisputeRecoveryAction(ID)).rejects.toThrow("db down");
  });
});

describe("setDisputeStatusAction", () => {
  it("answers { ok: true } on success", async () => {
    await expect(setDisputeStatusAction(ID, "submitted")).resolves.toEqual({ ok: true });
    expect(db.updateDispute).toHaveBeenCalledWith({ __fake: true }, ID, {
      status: "submitted",
    });
  });

  it("returns a validation refusal as { error }, and writes nothing", async () => {
    const res = await setDisputeStatusAction("nope", "submitted");
    expect("error" in res && res.error).toBeTruthy();
    expect(db.updateDispute).not.toHaveBeenCalled();
  });

  it("still throws a genuine failure", async () => {
    db.updateDispute.mockRejectedValue(new Error("db down"));
    await expect(setDisputeStatusAction(ID, "submitted")).rejects.toThrow("db down");
  });
});

describe("recordDisputeOutcomeAction", () => {
  it("answers { ok: true } on success", async () => {
    await expect(
      recordDisputeOutcomeAction(ID, { recoveredHours: 2, status: "resolved" }),
    ).resolves.toEqual({ ok: true });
  });

  it("returns a validation refusal as { error }, and writes nothing", async () => {
    const res = await recordDisputeOutcomeAction(ID, { recoveredHours: -1 });
    expect("error" in res && res.error).toBeTruthy();
    expect(db.updateDispute).not.toHaveBeenCalled();
  });

  it("still throws a genuine failure", async () => {
    db.updateDispute.mockRejectedValue(new Error("db down"));
    await expect(
      recordDisputeOutcomeAction(ID, { recoveredHours: 2 }),
    ).rejects.toThrow("db down");
  });
});

describe("deleteDisputeAction", () => {
  it("answers { ok: true } on success", async () => {
    await expect(deleteDisputeAction(ID)).resolves.toEqual({ ok: true });
  });

  it("returns a validation refusal as { error }", async () => {
    const res = await deleteDisputeAction("nope");
    expect("error" in res && res.error).toBeTruthy();
    expect(db.deleteDispute).not.toHaveBeenCalled();
  });

  it("still throws a genuine failure", async () => {
    db.deleteDispute.mockRejectedValue(new Error("db down"));
    await expect(deleteDisputeAction(ID)).rejects.toThrow("db down");
  });
});
