"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { OpCode } from "@/lib/types";

function revalidateOpCodes() {
  revalidatePath("/log");
  revalidatePath("/op-codes");
}

// Sub code shape accepted by create/update actions.
type SubCodeInput = {
  id?: string; // undefined = new (not yet in DB)
  code: string;
  description: string;
  flagHours: number;
};

export async function createLibraryOpCode(input: {
  code: string;
  description: string;
  flagHours: number;
  notes?: string;
  subCodes?: SubCodeInput[];
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

  if (input.subCodes && input.subCodes.length > 0) {
    await Promise.all(
      input.subCodes.map((sub, i) =>
        db.insertSubOpCode(supabase, created.id, created.userId, {
          code: sub.code.trim(),
          description: sub.description.trim(),
          flagHours: sub.flagHours,
          sortOrder: i,
        }),
      ),
    );
  }

  const full = await db.getOpCode(supabase, created.id);
  revalidateOpCodes();
  return full!;
}

export async function updateLibraryOpCode(
  id: string,
  patch: {
    code?: string;
    description?: string;
    flagHours?: number;
    notes?: string;
    subCodes?: SubCodeInput[];
    removedSubIds?: string[];
  },
): Promise<OpCode> {
  if (!id) throw new Error("Op code id is required.");

  const clean: { code?: string; description?: string; flagHours?: number; notes?: string } = {};
  if (patch.code !== undefined) {
    const code = patch.code.trim();
    if (!code) throw new Error("Op code is required.");
    clean.code = code;
  }
  if (patch.description !== undefined) clean.description = patch.description.trim();
  if (patch.flagHours !== undefined) {
    if (!Number.isFinite(patch.flagHours) || patch.flagHours < 0)
      throw new Error("Flag hours must be a non-negative number.");
    clean.flagHours = patch.flagHours;
  }
  if (patch.notes !== undefined) clean.notes = patch.notes.trim();

  const supabase = await createClient();
  await db.updateOpCode(supabase, id, clean);

  // Delete sub codes the user removed.
  if (patch.removedSubIds && patch.removedSubIds.length > 0) {
    await db.deleteSubOpCodes(supabase, patch.removedSubIds);
  }

  // Sync sub codes: insert new ones, update existing ones.
  if (patch.subCodes && patch.subCodes.length > 0) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated.");

    await Promise.all(
      patch.subCodes.map(async (sub, i) => {
        if (sub.id) {
          await db.updateSubOpCode(supabase, sub.id, {
            code: sub.code.trim(),
            description: sub.description.trim(),
            flagHours: sub.flagHours,
            sortOrder: i,
          });
        } else {
          await db.insertSubOpCode(supabase, id, user.id, {
            code: sub.code.trim(),
            description: sub.description.trim(),
            flagHours: sub.flagHours,
            sortOrder: i,
          });
        }
      }),
    );
  }

  const full = await db.getOpCode(supabase, id);
  revalidateOpCodes();
  return full!;
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
