"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { OpCode } from "@/lib/types";

function revalidateOpCodes() {
  revalidatePath("/log");
  revalidatePath("/op-codes");
}

export async function createLibraryOpCode(input: {
  code: string;
  description: string;
  flagHours: number;
  notes?: string;
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
    notes: input.notes?.trim(),
  });

  revalidateOpCodes();

  return created;
}

export async function updateLibraryOpCode(
  id: string,
  patch: { code?: string; description?: string; flagHours?: number; notes?: string },
): Promise<OpCode> {
  if (!id) throw new Error("Op code id is required.");

  const clean: { code?: string; description?: string; flagHours?: number; notes?: string } = {};
  if (patch.code !== undefined) {
    const code = patch.code.trim();
    if (!code) throw new Error("Op code is required.");
    clean.code = code;
  }
  if (patch.description !== undefined) {
    clean.description = patch.description.trim();
  }
  if (patch.flagHours !== undefined) {
    if (!Number.isFinite(patch.flagHours) || patch.flagHours < 0)
      throw new Error("Flag hours must be a non-negative number.");
    clean.flagHours = patch.flagHours;
  }
  if (patch.notes !== undefined) {
    clean.notes = patch.notes.trim();
  }

  const supabase = await createClient();
  const updated = await db.updateOpCode(supabase, id, clean);

  revalidateOpCodes();

  return updated;
}

export async function deleteLibraryOpCode(id: string): Promise<void> {
  if (!id) throw new Error("Op code id is required.");

  const supabase = await createClient();
  await db.deleteOpCode(supabase, id);

  revalidateOpCodes();
}

export async function reorderLibraryOpCodes(
  orderedIds: string[],
): Promise<void> {
  if (!Array.isArray(orderedIds))
    throw new Error("Expected an array of op code ids.");
  if (orderedIds.some((id) => typeof id !== "string" || !id))
    throw new Error("All op code ids must be non-empty strings.");

  const supabase = await createClient();
  await db.reorderOpCodes(supabase, orderedIds);

  revalidateOpCodes();
}
