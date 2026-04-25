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
    //   - public image/font file extensions
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
