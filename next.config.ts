import type { NextConfig } from "next";

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

export default nextConfig;
