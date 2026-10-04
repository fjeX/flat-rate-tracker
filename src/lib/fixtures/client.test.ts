import { describe, it, expect } from "vitest";
import { createFixtureClient } from "./client";

// The visual gate photographs whatever this client returns, so it must order
// rows the way PostgREST does: the FIRST .order() is primary. It used to make
// the last one primary, and a trailing `id` tiebreaker on listEntries flipped
// the fixture's Recent ROs to oldest-first while production was correct.
describe("fixture client ordering", () => {
  it("composes chained .order() calls first-primary, like PostgREST", async () => {
    const db = createFixtureClient() as unknown as {
      from(t: string): {
        select(s: string): {
          order(c: string, o?: { ascending?: boolean }): unknown;
        };
      };
    };
    const q = db
      .from("entries")
      .select("*")
      .order("date", { ascending: false }) as {
      order(c: string, o?: { ascending?: boolean }): PromiseLike<{ data: Array<{ date: string; id: string }> }>;
    };
    const { data } = await q.order("id", { ascending: true });
    const dates = data.map((r) => r.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0] > dates[dates.length - 1]).toBe(true);
  });
});
