// Shared Supabase client config.
//
// On the VM, the app container and the Supabase stack share the `proxy`
// Docker network. Server-side code can reach Kong directly over that network
// (SUPABASE_INTERNAL_URL) instead of going out through DNS → router →
// Traefik → Kong for every query. The browser can't resolve Docker hostnames,
// so client.ts always uses the public URL.

// Server-side Supabase URL: internal Docker URL when set, public otherwise
// (local dev, or VM before the env var is configured).
export function serverSupabaseUrl(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
  );
}

// supabase-js derives the auth cookie name from the URL's hostname:
// `sb-<first-label>-auth-token`. Server and browser clients use different
// URLs, so the name must be pinned explicitly or the server would look for
// the wrong cookie and treat everyone as signed out. Deriving from the
// public URL keeps the name identical to the pre-pinning default, so
// existing sessions stay valid.
export function authCookieName(): string {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}
