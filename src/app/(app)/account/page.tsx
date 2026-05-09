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

  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginBottom: 4 }}>Account</div>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--fg-2)" }}>
          Manage your profile, email, password, and display preferences.
        </p>
      </div>
      <AccountView
        initialFirstName={firstName}
        initialLastName={lastName}
        initialEmail={email}
        initialWeekStartDay={weekStartDay}
      />
    </main>
  );
}
