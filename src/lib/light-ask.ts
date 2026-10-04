// Server-side resolution of the dashboard's `?ask=<lineId>` pointer.
//
// The URL is editable by anyone, so nothing in it is believed: the id must be a
// uuid, the line must belong to the signed-in user (the RLS-scoped client simply
// cannot see anyone else's), and eligibility is re-run from the stored row. Any
// failure is silence: no ask, no error.
import * as db from "@/lib/db";
import { lineIdSchema } from "@/lib/validation/actions";
import {
  lightRetroForLine,
  type LightRetroCandidate,
} from "@/lib/retro-capture";
import type { OpCode } from "@/lib/types";

type Client = Parameters<typeof db.getEntry>[0];

export async function resolveLightAsk(
  supabase: Client,
  raw: string | string[] | undefined,
  opts: { optedIn: boolean; library: OpCode[] },
): Promise<LightRetroCandidate | null> {
  if (!opts.optedIn || typeof raw !== "string") return null;
  const parsed = lineIdSchema.safeParse(raw);
  if (!parsed.success) return null;
  try {
    const entryId = await db.getEntryIdForLine(supabase, parsed.data);
    if (!entryId) return null;
    const entry = await db.getEntry(supabase, entryId);
    if (!entry) return null;
    return lightRetroForLine(entry, parsed.data, opts.library, {
      optedIn: opts.optedIn,
    });
  } catch {
    return null;
  }
}
