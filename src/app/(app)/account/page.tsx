import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AccountView } from "@/components/account/AccountView";

export default async function AccountPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const weekStartDay = (Number(cookieStore.get("frt_week_start")?.value ?? "0") as 0 | 1);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const firstName = (user?.user_metadata?.first_name as string | undefined) ?? "";
  const lastName = (user?.user_metadata?.last_name as string | undefined) ?? "";
  const email = user?.email ?? "";

  // Drives whether the form asks for the current password. A Google-only
  // account has none to confirm — it is setting its first one. Defaults to
  // "yes, ask" if identities are missing, so the prompt fails closed; the
  // server re-derives this independently and does not trust the form.
  const hasPassword = user?.identities?.some((i) => i.provider === "email") ?? true;

  return (
    <main className="stg-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Account</h1>
          <p>Manage your profile, email, password, and display preferences.</p>
        </div>
      </div>
      <div className="stg-col">
        <AccountView
          initialFirstName={firstName}
          initialLastName={lastName}
          initialEmail={email}
          initialWeekStartDay={weekStartDay}
          hasPassword={hasPassword}
        />
      </div>
    </main>
  );
}
