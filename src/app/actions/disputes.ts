"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { disputeFromPack, pendingRecoveryApplication } from "@/lib/disputes";
import { buildDisputePack } from "@/lib/dispute-pack";
import { formatPeriodLabel, getRangeForPeriodKey } from "@/lib/periods";
import { ratesToMap } from "@/lib/earnings";
import { type Dispute, type DisputeStatus } from "@/lib/types";
import { validate } from "@/lib/validation/core";
import {
  disputeIdSchema,
  disputeLineRecoverySchema,
  disputeOutcomeSchema,
  openDisputeSchema,
  setDisputeStatusSchema,
} from "@/lib/validation/actions";

function revalidateDisputeScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/dashboard");
}

/**
 * Open a dispute for a period by rebuilding the pack SERVER-SIDE and freezing it.
 *
 * The claim is rebuilt here rather than accepted from the client on purpose: the
 * ledger's whole value is that it records what was actually owed, so the numbers
 * must come from the user's own rows, not from a payload a caller could shape.
 * The client only names the period and chooses the scope.
 *
 * `includePending` defaults to FALSE, and that default is the whole point. A
 * "pending" line is one with no paid hours recorded — which usually means the
 * tech never got around to marking it, NOT that the shop refused to pay it.
 * Claiming those as owed produced a claim four times the size of the shortfall
 * the page reported (80.7h against a 21.2h shortfall and a 58h stub), and the
 * printable pack — which has always defaulted pending OFF — disagreed with the
 * ledger about the same claim. Now the frozen claim matches the number the tech
 * was shown, and sweeping in never-marked lines is a decision they make out loud.
 */
export async function openDisputeAction(
  periodKeyArg: string,
  options: { includePending?: boolean } = {},
): Promise<Dispute> {
  const clean = validate(openDisputeSchema, { periodKey: periodKeyArg, options });
  const periodKey = clean.periodKey;
  const includePending = clean.options.includePending ?? false;
  const supabase = await createClient();

  // A live dispute already exists for this period — hand it back instead of
  // tripping the partial unique index. Makes a double-tap idempotent.
  const existing = await db.getOpenDisputeSafe(supabase, periodKey);
  if (existing) return existing;

  const settings = await db.getSettings(supabase);
  const range = getRangeForPeriodKey(
    periodKey,
    settings.splitDay,
    settings.periodOverrides,
  );
  if (!range) throw new Error(`Unrecognized period: ${periodKey}`);

  const [entries, library, rateRows] = await Promise.all([
    db.listEntries(supabase, { from: range.start, to: range.end }),
    db.listOpCodes(supabase),
    db.listLaborRates(supabase),
  ]);
  const rates = ratesToMap(rateRows);

  // Photo evidence is frozen per line, because the photo can be deleted later —
  // this is what makes the "do claims with evidence get paid?" comparison honest.
  const entryIdsWithPhotos = new Set(await db.listEntryIdsWithPhotos(supabase));

  const today = new Date().toISOString().slice(0, 10);
  const pack = buildDisputePack({
    entries,
    periodLabel: formatPeriodLabel(range),
    library,
    rates,
    // Off unless the tech asked for it (see the doc comment). Still gated on the
    // period being over even then — buildDisputePack refuses pending lines
    // mid-period, because a line nobody has been paid for yet isn't a dispute.
    includePending,
    periodEnd: range.end,
    today,
    entryIdsWithPhotos,
  });

  if (pack.totalShortHours <= 0) {
    throw new Error("Nothing to dispute in this period.");
  }

  const draft = disputeFromPack(pack, periodKey);
  // disputeFromPack can't know the photo index, so stamp it here.
  const lines = (draft.lines ?? []).map((l) => ({
    ...l,
    hadPhoto: l.entryId ? entryIdsWithPhotos.has(l.entryId) : false,
  }));

  const dispute = await db.createDispute(supabase, { ...draft, lines });
  revalidateDisputeScreens();
  return dispute;
}

/** Move a dispute along the lifecycle. Timestamps are stamped in the data layer. */
export async function setDisputeStatusAction(
  id: string,
  status: DisputeStatus,
): Promise<void> {
  const clean = validate(setDisputeStatusSchema, { id, status });
  const supabase = await createClient();
  await db.updateDispute(supabase, clean.id, { status: clean.status });
  revalidateDisputeScreens();
}

/**
 * Record the outcome: what came back, plus the note explaining it.
 *
 * Recovered amounts are NOT capped at the claimed amount — a shop settling
 * sometimes pays more than was asked (goodwill hours, a retroactive rate fix),
 * and clamping would make the ledger lie.
 */
export async function recordDisputeOutcomeAction(
  id: string,
  input: {
    recoveredHours: number;
    recoveredDollars?: number | null;
    note?: string;
    status?: DisputeStatus;
  },
): Promise<void> {
  const clean = validate(disputeOutcomeSchema, { id, input });
  const supabase = await createClient();
  await db.updateDispute(supabase, clean.id, {
    recoveredHours: clean.input.recoveredHours,
    recoveredDollars: clean.input.recoveredDollars ?? null,
    note: clean.input.note?.trim() ?? undefined,
    status: clean.input.status,
  });
  revalidateDisputeScreens();
}

/** Per-line outcome: a shop paying 3 of 4 disputed lines is the normal result. */
export async function setDisputeLineRecoveryAction(
  lineId: string,
  recoveredHours: number,
  recoveredDollars?: number | null,
): Promise<void> {
  const clean = validate(disputeLineRecoverySchema, {
    lineId,
    recoveredHours,
    recoveredDollars,
  });
  const supabase = await createClient();
  await db.updateDisputeLine(supabase, clean.lineId, {
    recoveredHours: clean.recoveredHours,
    recoveredDollars: clean.recoveredDollars ?? null,
  });
  revalidateDisputeScreens();
}

export async function deleteDisputeAction(id: string): Promise<void> {
  const disputeId = validate(disputeIdSchema, id);
  const supabase = await createClient();
  await db.deleteDispute(supabase, disputeId);
  revalidateDisputeScreens();
}

/**
 * Write a closed claim's recovered hours onto the RO lines they came back for.
 *
 * The bridge between the two ledgers. Without it, closing a claim moved the
 * recovery figure and left the period reading exactly as short as before, so
 * the second-round offer re-offered the same shortfall forever — money the shop
 * had already paid, asked for again, with no upper bound.
 *
 * Recomputed here from the user's own rows, never from a payload: same rule as
 * openDisputeAction. The client names a dispute; the server decides what that
 * means for the lines. Idempotent — pendingRecoveryApplication skips any line
 * whose paid hours have already moved past what the claim froze, so a
 * double-tap writes nothing the second time.
 */
export async function applyDisputeRecoveryAction(
  disputeIdArg: string,
): Promise<{ appliedLines: number; appliedHours: number }> {
  const disputeId = validate(disputeIdSchema, disputeIdArg);
  const supabase = await createClient();

  const disputes = await db.listDisputes(supabase);
  const dispute = disputes.find((d) => d.id === disputeId);
  if (!dispute) throw new Error("That claim no longer exists.");

  const settings = await db.getSettings(supabase);
  const range = getRangeForPeriodKey(
    dispute.periodKey,
    settings.splitDay,
    settings.periodOverrides,
  );
  if (!range) throw new Error(`Unrecognized period: ${dispute.periodKey}`);

  const [entries, library] = await Promise.all([
    db.listEntries(supabase, { from: range.start, to: range.end }),
    db.listOpCodes(supabase),
  ]);

  const plan = pendingRecoveryApplication(dispute, entries, library);
  if (plan.rows.length === 0) return { appliedLines: 0, appliedHours: 0 };

  // Sequential, not Promise.all: these are separate row updates with no
  // transaction around them, and a half-applied batch is far easier to read
  // back when the rows went in one at a time in a known order.
  for (const row of plan.rows) {
    await db.setLinePaidHours(supabase, row.lineId, row.paidAfter);
  }

  revalidateDisputeScreens();
  return { appliedLines: plan.rows.length, appliedHours: plan.applyHours };
}
