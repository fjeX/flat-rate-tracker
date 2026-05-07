"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateProfile(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const firstName = (formData.get("first_name") as string | null)?.trim() ?? "";
  const lastName = (formData.get("last_name") as string | null)?.trim() ?? "";

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { first_name: firstName, last_name: lastName },
  });

  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/account");
  return { message: "Profile updated." };
}

export async function updateEmail(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";

  if (!email) return { error: "Email is required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) return { error: error.message };
  return { message: "Check your inbox to confirm your new email address." };
}

export async function updatePassword(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const newPassword = (formData.get("new_password") as string | null) ?? "";
  const confirmPassword = (formData.get("confirm_password") as string | null) ?? "";

  if (newPassword.length < 8) return { error: "Password must be at least 8 characters." };
  if (newPassword !== confirmPassword) return { error: "Passwords do not match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) return { error: error.message };
  return { message: "Password changed successfully." };
}
