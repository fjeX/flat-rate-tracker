import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

// The single gate for every /admin/* page. Auth is already handled by the (app)
// layout above; this layer adds the is_admin check. Any page added under /admin
// inherits it automatically — no per-page guard needed.
//
// notFound() (404) rather than a redirect: a non-admin shouldn't even learn the
// route exists. Defense-in-depth on top of RLS, which independently refuses to
// return admin data to non-admins.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const isAdmin = await db.isCurrentUserAdmin(supabase);
  if (!isAdmin) notFound();

  return <>{children}</>;
}
