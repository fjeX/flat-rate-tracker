"use client";

import Link from "next/link";
import { BottomNav } from "./BottomNav";
import { MainList, SubList } from "./DirLists";
import { LogoMark, LogoWord } from "./icons";
import { APP_BOTTOM, APP_ITEMS, APP_SUB } from "./nav-items";

/**
 * Desktop rail (final.html aside.rail) plus the phone bottom bar. CSS shows
 * one or the other at the 1024px breakpoint; both are always in the DOM.
 */
export function Nav({ timerRunning = false }: { timerRunning?: boolean }) {
  return (
    <>
      <aside className="rail" aria-label="Directory">
        <Link href="/dashboard" className="logo" aria-label="Flat Rate Tracker, go to Dashboard">
          <LogoMark />
          <LogoWord />
        </Link>
        <nav aria-label="Pages">
          <MainList items={APP_ITEMS} timerRunning={timerRunning} />
        </nav>
        <SubList items={APP_SUB} />
      </aside>
      <BottomNav items={APP_BOTTOM} timerRunning={timerRunning} />
    </>
  );
}
