"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { OpCode } from "@/lib/types";

export async function createLibraryOpCode(input: {
  code: string;
  description: string;
  flagHours: number;
}): Promise<OpCode> {
  const code = input.code.trim();
  if (!code) throw new Error("Op code is required.");
  if (!Number.isFinite(input.flagHours) || input.flagHours < 0)
    throw new Error("Flag hours must be a non-negative number.");

  const supabase = await createClient();
  const created = await db.createOpCode(supabase, {
    code,
    description: input.description.trim(),
    flagHours: input.flagHours,
  });

  revalidatePath("/log");
  revalidatePath("/op-codes");

  return created;
}
