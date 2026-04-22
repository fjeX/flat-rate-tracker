import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proxy should have already redirected unauthenticated users, but belt-and-
  // suspenders: double-check here since this is a protected route.
  if (!user) {
    redirect("/signin");
  }

  // Fetch the user's op codes to prove the signup trigger ran. Temporary —
  // this page becomes the real Dashboard in a later step.
  const { data: opCodes } = await supabase
    .from("op_codes")
    .select("code, description, flag_hours")
    .order("sort_order", { ascending: true });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Flat Rate Tracker</h1>
            <p className="text-sm text-zinc-400">Signed in as {user.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-sm transition-colors"
            >
              Sign out
            </button>
          </form>
        </header>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">
            Your op code library
          </h2>
          {opCodes && opCodes.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {opCodes.map((oc) => (
                <li
                  key={oc.code}
                  className="flex items-center justify-between border-b border-zinc-800 last:border-0 py-1.5"
                >
                  <span>
                    <span className="font-mono text-orange-400">{oc.code}</span>
                    <span className="text-zinc-500"> — {oc.description}</span>
                  </span>
                  <span className="text-zinc-400">{oc.flag_hours}h</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No op codes yet.</p>
          )}
        </section>

        <p className="text-xs text-zinc-600">
          Phase 1 scaffold — full Dashboard coming next.
        </p>
      </div>
    </main>
  );
}
