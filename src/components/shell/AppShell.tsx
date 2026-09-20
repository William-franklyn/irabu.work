"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ViewAsBanner } from "./ViewAsBanner";
import type { WorkspaceMembership } from "@/lib/auth/guard";

/**
 * Holds the one piece of state the sidebar and the top bar have to agree on:
 * whether the mobile nav drawer is open. The layout above is a server
 * component, so it can't own this — and threading it through context for a
 * single boolean read by two adjacent siblings would be heavier than it is
 * worth.
 */
export function AppShell({
  orgId,
  orgName,
  fullName,
  role,
  viewingAs,
  memberships,
  canManageAgents,
  children,
}: {
  orgId: string;
  orgName: string;
  fullName: string | null;
  role: "owner" | "admin" | "member";
  viewingAs: boolean;
  memberships: WorkspaceMembership[];
  canManageAgents: boolean;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {viewingAs && <ViewAsBanner role={role} />}
      <div className="flex flex-1">
        <Sidebar
          orgId={orgId}
          orgName={orgName}
          memberships={memberships}
          canManageAgents={canManageAgents}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto and
            so refuses to shrink below its content, which is what lets one wide
            table push the entire page into horizontal scroll. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar fullName={fullName} onOpenNav={() => setMobileNavOpen(true)} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
