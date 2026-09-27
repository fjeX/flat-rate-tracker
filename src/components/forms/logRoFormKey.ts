// The React key the authed /log page mounts LogRoForm under — one form instance
// per TARGET (logroform-no-key-carryover).
//
// useLogRoForm seeds every field from existingEntry exactly once, in useState
// initialisers. /log → /log?edit=X (the "already open" warning's Edit / Close
// links) is a searchParams-only soft nav: the page re-renders but, unkeyed, the
// form does NOT remount — so a half-typed new RO rode straight into the
// ticket's edit/close form. A different key is a different component.
//
// closeMode is part of the key because close seeds differently from edit (date
// = today, time = now, then the close-defaults fetch), so ?edit=X →
// ?edit=X&close=1 is a different target as well. A server re-render of the SAME
// target (revalidatePath mid-close, a fresh existingEntry object) keeps the key,
// and with it everything the tech has typed.
//
// Its own plain module, not an export of LogRoForm.tsx: that file is
// "use client", and a function imported from it into the Server Component page
// would arrive as a client reference, not something the server can call.
export function logRoFormKey(existingEntryId: string | undefined, closeMode: boolean): string {
  if (!existingEntryId) return "new";
  return `${existingEntryId}:${closeMode ? "close" : "edit"}`;
}
