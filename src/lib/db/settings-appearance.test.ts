// getSettings + theme/accent: a DB that predates 20260929000000_appearance.sql
// returns rows with no theme/accent key. That must read as the defaults, not throw.
import { describe, it, expect } from "vitest";
import { getSettings } from "./settings";
import type { DbClient } from "./_client";

function client(row: Record<string, unknown> | null): DbClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: () => chain,
  } as unknown as DbClient;
}

const baseRow = {
  user_id: "u1",
  split_day: 15,
  goal_hours: 88,
  period_overrides: {},
  updated_at: "2026-09-29T00:00:00Z",
  ro_template: null,
  default_labor_type: null,
  reference_hourly_rate: null,
  tag_colors: {},
  share_labor_times: false,
  track_ro_time: false,
};

describe("getSettings appearance", () => {
  it("reads the saved theme and accent", async () => {
    const s = await getSettings(client({ ...baseRow, theme: "light", accent: "orange" }));
    expect([s.theme, s.accent]).toEqual(["light", "orange"]);
  });

  it("defaults when the columns are absent (pre-migration DB)", async () => {
    const s = await getSettings(client(baseRow));
    expect([s.theme, s.accent]).toEqual(["dark", "blue"]);
  });

  it("defaults on out-of-list values", async () => {
    const s = await getSettings(client({ ...baseRow, theme: "neon", accent: null }));
    expect([s.theme, s.accent]).toEqual(["dark", "blue"]);
  });

  it("defaults when the account has no settings row", async () => {
    const s = await getSettings(client(null));
    expect([s.theme, s.accent]).toEqual(["dark", "blue"]);
  });
});
