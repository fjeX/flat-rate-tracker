"use client";

import { useRouter } from "next/navigation";
import { useGuestStore } from "@/lib/guest/context";
import { LogRoForm } from "@/components/forms/LogRoForm";
import type { NewEntry } from "@/lib/types";

export default function GuestLogPage() {
  const { opCodes, addEntry, addGuestOpCode } = useGuestStore();
  const router = useRouter();

  function handleSave(input: NewEntry) {
    addEntry(input);
    router.push("/guest");
  }

  return (
    <LogRoForm
      initialOpCodes={opCodes}
      roTemplates={[]}
      onSave={handleSave}
      onCreateOpCode={addGuestOpCode}
      redirectTo="/guest"
    />
  );
}
