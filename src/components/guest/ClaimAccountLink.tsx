"use client";

import Link from "next/link";
import { markGuestClaim } from "@/lib/guest/storage";

/**
 * The one and only path that authorizes guest work to be written into an
 * account. Clicking it records the visitor's intent; GuestSyncEffect refuses
 * to sync anything without that record.
 */
export function ClaimAccountLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={className} onClick={markGuestClaim}>
      {children}
    </Link>
  );
}
