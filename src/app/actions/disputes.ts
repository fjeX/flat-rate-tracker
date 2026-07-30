"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { disputeFromPack } from "@/lib/disputes";
import { buildDisputePack } from "@/lib/dispute-pack";
import { formatPeriodLabel, getRangeForPeriodKey } from "@/lib/periods";
import { ratesToMap } from "@/lib/earnings";
import { isDisputeStatus, type Dispute, type DisputeStatus } from "@/lib/types";

function revalidateDisputeScreens() {
  revalidatePath("/pay-period");
  revalidatePath("/dashboard");
}

const MAX_HOURS = 99999; // numeric(7,2) ceiling
const MAX_DOLLARS = 99999999; // numeric(10,2) ceiling

function validHours(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0 || n > MAX_HOURS) {
    throw new Error(`${label} must be an hours figure of 0 or more.`);
  }
}

function validDollars(n: number | null | undefined, label: string): void {
  if (n === null || n === undefined) return;
  if (!Number.isFinite(n) || n < 0 || n > MAX_DOLLARS) {
    throw new Error(`${label} must be a dollar figure of $0 or more.`);
  }
}

/**
 * Open a dispute for a period by rebuilding the pack SERVER-SIDE and freezing it.
 *
 * The claim is rebuilt here rather than accepted from the client on purpose: the
 * ledger's whole value is that it records what was actually owed, so the numbers
 * must come from the user's own rows, not from a payload a caller could shape.
 * The client only names the period.
 */
export async function openDisputeAction(periodKey: string): Promise<Dispute> {
  if (!periodKey) throw new Error("Period is required.");
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
    // A claim is only worth raising once the period is over; buildDisputePack
    // gates pending lines on exactly this, so pass the dates through.
    includePending: true,
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
  if (!id) throw new Error("Dispute ID is required.");
  if (!isDisputeStatus(status)) throw new Error(`Unknown status: ${status}`);
  const supabase = await createClient();
  await db.updateDispute(supabase, id, { status });
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
  if (!id) throw new Error("Dispute ID is required.");
  validHours(input.recoveredHours, "Recovered hours");
  validDollars(input.recoveredDollars, "Recovered dollars");
  if (input.status !== undefined && !isDisputeStatus(input.status)) {
    throw new Error(`Unknown status: ${input.status}`);
  }
  const supabase = await createClient();
  await db.updateDispute(supabase, id, {
    recoveredHours: input.recoveredHours,
    recoveredDollars: input.recoveredDollars ?? null,
    note: input.note?.trim() ?? undefined,
    status: input.status,
  });
  revalidateDisputeScreens();
}

/** Per-line outcome: a shop paying 3 of 4 disputed lines is the normal result. */
export async function setDisputeLineRecoveryAction(
  lineId: string,
  recoveredHours: number,
  recoveredDollars?: number | null,
): Promise<void> {
  if (!lineId) throw new Error("Line ID is required.");
  validHours(recoveredHours, "Recovered hours");
  validDollars(recoveredDollars, "Recovered dollars");
  const supabase = await createClient();
  await db.updateDisputeLine(supabase, lineId, {
    recoveredHours,
    recoveredDollars: recoveredDollars ?? null,
  });
  revalidateDisputeScreens();
}

export async function deleteDisputeAction(id: string): Promise<void> {
  if (!id) throw new Error("Dispute ID is required.");
  const supabase = await createClient();
  await db.deleteDispute(supabase, id);
  revalidateDisputeScreens();
}
