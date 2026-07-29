"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createLibraryOpCode } from "@/app/actions/op-codes";
import { saveEntry } from "@/app/actions/entries";
import { GUEST_SAMPLE_OPCODES } from "@/lib/guest/context";
import {
  GUEST_STORAGE_KEY,
  clearGuestSession,
  hasGuestClaim,
} from "@/lib/guest/storage";
import type { Entry, OpCode, NewEntry, NewEntryOpCode } from "@/lib/types";

type GuestState = { entries: Entry[]; opCodes: OpCode[] };

export function GuestSyncEffect() {
  const router = useRouter();

  useEffect(() => {
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSync() {
    // Consent gate. Guest data in this tab is not permission to write it into
    // the signed-in account — only an explicit hand-off from guest mode is.
    // Without it we leave sessionStorage untouched so the guest tab keeps
    // working exactly as it did.
    if (!hasGuestClaim()) return;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(GUEST_STORAGE_KEY);
    } catch {
      return;
    }

    if (!raw) return;

    let guestState: GuestState;
    try {
      const parsed = JSON.parse(raw) as Partial<GuestState>;
      guestState = {
        entries: parsed.entries ?? [],
        opCodes: parsed.opCodes ?? [],
      };
    } catch (err) {
      console.error("[GuestSync] Failed to parse guest session data:", err);
      return;
    }

    // Custom op codes: IDs that don't start with "g-"
    const customOpCodes = guestState.opCodes.filter(
      (op) => !op.id.startsWith("g-"),
    );

    const hasEntries = guestState.entries.length > 0;
    const hasCustomOpCodes = customOpCodes.length > 0;

    if (!hasEntries && !hasCustomOpCodes) return;

    // Map from guest op code ID → real DB op code ID
    const idMap = new Map<string, string>();

    // 1. Sync custom op codes (sequentially to avoid rate limits)
    for (const op of customOpCodes) {
      try {
        const created = await createLibraryOpCode({
          code: op.code,
          description: op.description,
          flagHours: op.flagHours,
          notes: op.notes ?? "",
          subCodes: [],
        });
        idMap.set(op.id, created.id);
      } catch (err) {
        console.error("[GuestSync] Failed to create op code:", op.code, err);
        // Don't clear sessionStorage — data is not fully synced
        return;
      }
    }

    // 2. Sync entries (sequentially)
    for (const entry of guestState.entries) {
      const remappedLines: NewEntryOpCode[] = entry.opCodes.map((line) => {
        // Already a custom (ad-hoc) line — keep as-is
        if (line.custom) {
          return {
            opCodeId: null,
            custom: true,
            customCode: line.customCode,
            customDescription: line.customDescription,
            flagHours: line.flagHours,
            actualHours: line.actualHours,
            notes: line.notes,
            position: line.position,
            subOpCodeId: null,
            laborType: line.laborType ?? null,
          };
        }

        // Library op code that was synced to a real ID
        if (line.opCodeId && idMap.has(line.opCodeId)) {
          return {
            opCodeId: idMap.get(line.opCodeId)!,
            custom: false,
            customCode: null,
            customDescription: null,
            flagHours: line.flagHours,
            actualHours: line.actualHours,
            notes: line.notes,
            position: line.position,
            subOpCodeId: null,
            laborType: line.laborType ?? null,
          };
        }

        // Sample op code (starts with "g-") or unknown — convert to custom line
        const sampleOp = GUEST_SAMPLE_OPCODES.find(
          (s) => s.id === line.opCodeId,
        );
        return {
          opCodeId: null,
          custom: true,
          customCode: sampleOp?.code ?? line.customCode ?? "",
          customDescription: sampleOp?.description ?? line.customDescription ?? "",
          flagHours: line.flagHours,
          actualHours: line.actualHours,
          notes: line.notes,
          position: line.position,
          subOpCodeId: null,
          laborType: line.laborType ?? null,
        };
      });

      const newEntry: NewEntry = {
        date: entry.date,
        roNumber: entry.roNumber,
        vehicle: entry.vehicle,
        notes: entry.notes,
        opCodes: remappedLines,
      };

      try {
        await saveEntry(newEntry);
      } catch (err) {
        console.error("[GuestSync] Failed to save entry:", entry.roNumber, err);
        // Don't clear sessionStorage — data is not fully synced
        return;
      }
    }

    // All op codes and entries synced successfully — retire the guest session
    // AND the claim, so a later visit can't re-sync stale data.
    clearGuestSession();

    router.refresh();
  }

  return null;
}
