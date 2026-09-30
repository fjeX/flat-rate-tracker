// saveAppearance: every expected refusal is a returned { error }, never a throw
// (a thrown refusal is masked in production — escalation
// server-action-thrown-refusals-masked), and nothing is written on a refusal.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  user: { id: "u1" } as { id: string } | null,
  updateFails: false as false | { message: string },
  updates: [] as unknown[],
};
const revalidatePath = vi.fn();
const reportServerError = vi.fn();

vi.mock("@/lib/report-error-server", () => ({
  reportServerError: (...a: unknown[]) => reportServerError(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));
vi.mock("@/lib/db", () => ({
  updateSettings: async (_c: unknown, patch: unknown) => {
    if (state.updateFails) throw state.updateFails;
    state.updates.push(patch);
    return {};
  },
}));

import { saveAppearance } from "./appearance";

beforeEach(() => {
  state.user = { id: "u1" };
  state.updateFails = false;
  state.updates = [];
  revalidatePath.mockClear();
  reportServerError.mockClear();
});

describe("saveAppearance", () => {
  it("saves a valid pair and revalidates", async () => {
    expect(await saveAppearance({ theme: "dark-pitch", accent: "teal" })).toEqual({});
    expect(state.updates).toEqual([{ theme: "dark-pitch", accent: "teal" }]);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("refuses an unknown theme with { error } and writes nothing", async () => {
    const r = await saveAppearance({ theme: "neon" as never, accent: "blue" });
    expect(r.error).toBeTruthy();
    expect(state.updates).toEqual([]);
  });

  it("refuses an unknown accent with { error } and writes nothing", async () => {
    const r = await saveAppearance({ theme: "dark", accent: "pink" as never });
    expect(r.error).toBeTruthy();
    expect(state.updates).toEqual([]);
  });

  it("refuses when signed out", async () => {
    state.user = null;
    const r = await saveAppearance({ theme: "dark", accent: "blue" });
    expect(r.error).toMatch(/authenticated/i);
    expect(state.updates).toEqual([]);
  });

  it("pre-migration: returns { error }, and does NOT report (local dev runs against prod)", async () => {
    // PostgREST's shape: a plain object, not an Error.
    state.updateFails = {
      message: "Could not find the 'theme' column of 'user_settings' in the schema cache",
    };
    const r = await saveAppearance({ theme: "light", accent: "ink" });
    expect(r.error).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it("any other DB failure: returns { error } AND reports it", async () => {
    // Mentions the column, but it is a grant fault, not a missing column.
    state.updateFails = { message: "permission denied for column theme of relation user_settings" };
    const r = await saveAppearance({ theme: "light", accent: "ink" });
    expect(r.error).toBeTruthy();
    expect(reportServerError).toHaveBeenCalledOnce();
  });
});
