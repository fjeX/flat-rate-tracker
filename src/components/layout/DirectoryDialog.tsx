"use client";

// Phone directory: every page plus the account items, in the shared Modal
// (bottom sheet, focus trap, scroll lock, Escape). `extra` renders below the
// lists so a shell can add its own controls (guest Appearance) without this
// component knowing about them.
import { useState, type ComponentProps, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "./icons";
import { MainList, SubList } from "./DirLists";
import type { NavItem, SubItem } from "./nav-items";

export function DirectoryDialog({
  open,
  onClose,
  items,
  sub = [],
  timerRunning = false,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  sub?: SubItem[];
  timerRunning?: boolean;
  extra?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Directory">
      {/* .dir-body pulls the rows flush to the sheet edges, as in the mock. */}
      <div className="dir-body">
        <nav aria-label="Pages">
          <MainList items={items} timerRunning={timerRunning} onNavigate={onClose} />
        </nav>
        <SubList items={sub} onNavigate={onClose} />
        {extra != null && <div className="dir-extra">{extra}</div>}
      </div>
    </Modal>
  );
}

/** The topbar menu button plus its dialog, so a server-rendered Header can drop it in. */
export function DirectoryButton(props: Omit<ComponentProps<typeof DirectoryDialog>, "open" | "onClose">) {
  // Open means "opened on THIS page": a navigation that did not come from a
  // directory link (the back button) must not leave the sheet over the new page.
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;

  return (
    <>
      <button
        type="button"
        className="iconbtn"
        aria-haspopup="dialog"
        aria-label="Directory: all pages and account"
        onClick={() => setOpenAt(pathname)}
      >
        <Icon name="menu" />
      </button>
      <DirectoryDialog {...props} open={open} onClose={() => setOpenAt(null)} />
    </>
  );
}
