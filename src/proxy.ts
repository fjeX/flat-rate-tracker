// Next.js 16 proxy — runs before every matched request.
// Renamed from middleware.ts in Next 16.
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Match all request paths except:
    //   - _next/static (static files)
    //   - _next/image (image optimizer)
    //   - favicon.ico, sitemap.xml, robots.txt
    //   - monitoring (Sentry tunnel: no session refresh, and must never be
    //     redirected to /signin — a crash on the sign-in page still reports)
    //   - public image/font file extensions
    "/((?!_next/static|_next/image|monitoring$|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
