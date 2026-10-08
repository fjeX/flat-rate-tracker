import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { classifySupabaseUrl } from "./src/lib/supabase/environments";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      // The backup import (importDataAction) sends the entire account — every
      // RO, op code, daily clock, bonus, and settings — as a single Server
      // Action argument. Next.js caps Server Action request bodies at 1MB by
      // default and rejects anything larger at the framework layer, before our
      // own try/catch can surface the friendly "Couldn't import" message. A full
      // account easily exceeds 1MB, so raise the ceiling. (bug report 37a5962e)
      bodySizeLimit: "25mb",
    },
  },
};

// `next dev` only runs against staging or a local Supabase stack — see
// src/lib/supabase/environments.ts for why it's an allowlist. Builds and
// `next start` (the VM, the visual canary) are untouched: they're a different
// phase and never reach this check.
//
// Escape hatch for reproducing a prod-only bug, on the COMMAND LINE only:
//   FRT_ALLOW_PROD_DEV=1 NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… npm run dev
// Never put it in .env.local — then the guard is off for every session after.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER && process.env.FRT_ALLOW_PROD_DEV !== "1") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (classifySupabaseUrl(url) === "other") {
      throw new Error(
        `\n\nRefusing to start the dev server against ${url ?? "(no NEXT_PUBLIC_SUPABASE_URL)"}.\n` +
          "Local dev runs against STAGING so test writes never land in real users' data.\n" +
          "Fix: point .env.local at staging (see .env.example). To deliberately run\n" +
          "against prod for one session, set FRT_ALLOW_PROD_DEV=1 on the command line.\n",
      );
    }
  }
  return nextConfig;
}
