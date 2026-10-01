"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/layout/BottomNav";
import { DirectoryButton } from "@/components/layout/DirectoryDialog";
import { MainList } from "@/components/layout/DirLists";
import { Icon, LogoMark, LogoWord } from "@/components/layout/icons";
import { Modal } from "@/components/ui/Modal";
import { GuestAppearance } from "./GuestAppearance";
import { GUEST_BOTTOM, GUEST_ITEMS } from "@/components/layout/nav-items";
import { useGuestStore } from "@/lib/guest/context";
import { anyAccruing } from "@/lib/timer";

// Guest mode has no floating TimerPip (it depends on server-fetched app
// context); mirroring the authed Nav's running dot on the Timer item is the
// least-invasive way to surface "you have a timer going" while browsing other
// guest pages. "Something is banking time" includes a job on hold, since
// waiting time is still being counted.
function useGuestTimerRunning(): boolean {
  const { timers } = useGuestStore();
  return anyAccruing(timers);
}

/** Rail (desktop) + bottom bar (phone) with the guest routes. */
export function GuestNav() {
  const timerRunning = useGuestTimerRunning();
  return (
    <>
      <aside className="rail" aria-label="Directory">
        <Link href="/" className="logo" aria-label="Flat Rate Tracker">
          <LogoMark />
          <LogoWord />
        </Link>
        <nav aria-label="Pages">
          <MainList items={GUEST_ITEMS} timerRunning={timerRunning} />
        </nav>
        <RailAppearance />
      </aside>
      <BottomNav items={GUEST_BOTTOM} timerRunning={timerRunning} />
    </>
  );
}

/**
 * Desktop has no top bar, so no directory, so the guest Appearance controls
 * would be unreachable there. The rail's sub slot opens them in a dialog
 * instead (signed-in users have Settings > Appearance).
 */
function RailAppearance() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ul className="dir-list dir-sub">
        <li>
          <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Icon name="theme" />
            Appearance
          </button>
        </li>
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Appearance">
        <GuestAppearance />
      </Modal>
    </>
  );
}

/**
 * Directory button for the guest top bar (pass it to Header's `actions`).
 * `extra` lands at the bottom of the dialog body: the guest Appearance controls.
 */
export function GuestDirectoryButton({ extra }: { extra?: ReactNode }) {
  const timerRunning = useGuestTimerRunning();
  return <DirectoryButton items={GUEST_ITEMS} timerRunning={timerRunning} extra={extra} />;
}
