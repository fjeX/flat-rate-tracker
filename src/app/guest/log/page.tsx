"use client";

import { useRouter } from "next/navigation";
import { useGuestStore, GUEST_SAMPLE_OPCODES } from "@/lib/guest/context";
import { LogRoForm } from "@/components/forms/LogRoForm";
import type { NewEntry } from "@/lib/types";

export default function GuestLogPage() {
  const { addEntry, makeOpCode } = useGuestStore();
  const router = useRouter();

  function handleSave(input: NewEntry) {
    addEntry(input);
    router.push("/guest");
  }

  return (
    <LogRoForm
      initialOpCodes={GUEST_SAMPLE_OPCODES}
      roTemplates={[]}
      onSave={handleSave}
      onCreateOpCode={makeOpCode}
      redirectTo="/guest"
    />
  );
}
