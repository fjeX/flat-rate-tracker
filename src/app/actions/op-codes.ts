"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { validate } from "@/lib/validation/core";
import {
  createOpCodeSchema,
  opCodeIdSchema,
  reorderOpCodesSchema,
  tagColorSchema,
  updateOpCodeSchema,
} from "@/lib/validation/actions";
import type { OpCode } from "@/lib/types";

function revalidateOpCodes() {
  revalidatePath("/log");
  revalidatePath("/op-codes");
}

// Clean up freeform tags: trim, drop blanks, and dedupe case-insensitively
// (so "Brakes" and "brakes" don't both stick) while keeping the case as typed.
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// Set (or clear, with null) the colour override for a library tag.
// Tag colours are library-wide, keyed by lowercased tag; hue is a slot index
// into the 8 --tag-hue-N theme tokens. Unset tags keep their hash colour.
export async function setTagColorAction(
  tag: string,
  hue: number | null,
): Promise<void> {
  const clean = validate(tagColorSchema, { tag, hue });
  const key = clean.tag.toLowerCase();
  const hueSlot = clean.hue;

  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  const next = { ...settings.tagColors };
  if (hueSlot === null) delete next[key];
  else next[key] = hueSlot;
  try {
    await db.updateSettings(supabase, { tagColors: next });
  } catch (err) {
    // Pre-migration DB: the tag_colors column doesn't exist yet. Postgres
    // says 42703, PostgREST's schema cache says PGRST204.
    const e = err as { code?: string; message?: string } | null;
    if (e?.code === "42703" || e?.code === "PGRST204" || /tag_colors/.test(e?.message ?? "")) {
      throw new Error(
        "Tag colors aren't enabled on the server yet — the tag_colors migration needs to run first.",
      );
    }
    throw err;
  }

  revalidateOpCodes();
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
  tags?: string[];
  subCodes?: SubCodeInput[];
}): Promise<OpCode> {
  const clean = validate(createOpCodeSchema, input);

  const supabase = await createClient();
  const created = await db.createOpCode(supabase, {
    code: clean.code,
    description: clean.description.trim(),
    flagHours: clean.flagHours,
    notes: clean.notes?.trim(),
    tags: normalizeTags(clean.tags),
  });

  if (clean.subCodes && clean.subCodes.length > 0) {
    await Promise.all(
      clean.subCodes.map((sub, i) =>
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
    tags?: string[];
    subCodes?: SubCodeInput[];
    removedSubIds?: string[];
  },
): Promise<OpCode> {
  const parsed = validate(updateOpCodeSchema, { id, patch });
  const opCodeId = parsed.id;
  const cleanPatch = parsed.patch;

  // Only the keys the caller actually sent — an absent key means "leave this
  // column alone", which is not the same as writing a default over it.
  const clean: { code?: string; description?: string; flagHours?: number; notes?: string; tags?: string[] } = {};
  if (cleanPatch.code !== undefined) clean.code = cleanPatch.code;
  if (cleanPatch.description !== undefined)
    clean.description = cleanPatch.description.trim();
  if (cleanPatch.flagHours !== undefined) clean.flagHours = cleanPatch.flagHours;
  if (cleanPatch.notes !== undefined) clean.notes = cleanPatch.notes.trim();
  if (cleanPatch.tags !== undefined) clean.tags = normalizeTags(cleanPatch.tags);

  const supabase = await createClient();
  await db.updateOpCode(supabase, opCodeId, clean);

  // Delete sub codes the user removed.
  if (cleanPatch.removedSubIds && cleanPatch.removedSubIds.length > 0) {
    await db.deleteSubOpCodes(supabase, cleanPatch.removedSubIds);
  }

  // Sync sub codes: insert new ones, update existing ones.
  if (cleanPatch.subCodes && cleanPatch.subCodes.length > 0) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated.");

    await Promise.all(
      cleanPatch.subCodes.map(async (sub, i) => {
        if (sub.id) {
          await db.updateSubOpCode(supabase, sub.id, {
            code: sub.code.trim(),
            description: sub.description.trim(),
            flagHours: sub.flagHours,
            sortOrder: i,
          });
        } else {
          await db.insertSubOpCode(supabase, opCodeId, user.id, {
            code: sub.code.trim(),
            description: sub.description.trim(),
            flagHours: sub.flagHours,
            sortOrder: i,
          });
        }
      }),
    );
  }

  const full = await db.getOpCode(supabase, opCodeId);
  revalidateOpCodes();
  return full!;
}

export async function deleteLibraryOpCode(id: string): Promise<void> {
  const opCodeId = validate(opCodeIdSchema, id);
  const supabase = await createClient();
  await db.deleteOpCode(supabase, opCodeId);
  revalidateOpCodes();
}

export async function reorderLibraryOpCodes(
  orderedIds: string[],
): Promise<void> {
  const clean = validate(reorderOpCodesSchema, orderedIds);

  const supabase = await createClient();
  await db.reorderOpCodes(supabase, clean);
  revalidateOpCodes();
}
