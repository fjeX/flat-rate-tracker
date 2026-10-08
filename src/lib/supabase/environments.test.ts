import { describe, it, expect } from "vitest";
import { classifySupabaseUrl, STAGING_URL } from "./environments";

describe("classifySupabaseUrl — the dev-server allowlist", () => {
  it("accepts staging and a local stack", () => {
    expect(classifySupabaseUrl(STAGING_URL)).toBe("staging");
    expect(classifySupabaseUrl("http://127.0.0.1:54321")).toBe("local");
    expect(classifySupabaseUrl("http://localhost:54321")).toBe("local");
  });

  it("refuses today's prod and any future prod it has never heard of", () => {
    expect(classifySupabaseUrl("https://api.slimelab.cc")).toBe("other");
    // The Phase 1 Cloud project: unknown ref → refused without anyone updating a list.
    expect(classifySupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe("other");
  });

  it("is not fooled by staging's ref appearing somewhere other than the host", () => {
    expect(classifySupabaseUrl(`https://evil.example/${STAGING_URL}`)).toBe("other");
    expect(classifySupabaseUrl("https://dazwengljgvpbmeovuiy.supabase.co.evil.example")).toBe("other");
  });

  it("treats missing or garbage as not allowed", () => {
    expect(classifySupabaseUrl(undefined)).toBe("other");
    expect(classifySupabaseUrl("")).toBe("other");
    expect(classifySupabaseUrl("not a url")).toBe("other");
  });
});
