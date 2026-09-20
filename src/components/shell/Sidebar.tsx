"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsLeft, ChevronsRight, ChevronsUpDown, Check, Plus } from "lucide-react";
import clsx from "clsx";
import { navItems } from "@/lib/nav";
import { Logo } from "@/components/ui/Logo";
import type { WorkspaceMembership } from "@/lib/auth/guard";

const STORAGE_KEY = "irabu-sidebar-collapsed";

function WorkspaceSwitcher({
  orgId,
  orgName,
  memberships,
  collapsed,
}: {
  orgId: string;
  orgName: string;
  memberships: WorkspaceMembership[];
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  async function switchTo(id: string) {
    if (id === orgId || busy) return;
    setBusy(true);
    const res = await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    }
  }

  async function createWorkspace() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setNewName("");
      setCreating(false);
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? orgName : undefined}
        className={clsx(
          "flex items-center gap-1.5 rounded-[var(--radius-sm)] text-left transition-colors hover:bg-[var(--surface-sunken)]",
          collapsed ? "h-8 w-8 justify-center" : "w-full px-1.5 py-1",
        )}
      >
        {collapsed ? (
          <span className="text-[var(--text-xs)] font-semibold">{orgName.slice(0, 1).toUpperCase()}</span>
        ) : (
          <>
            <span className="max-w-[8rem] truncate text-[var(--text-xs)] text-[var(--muted)]">{orgName}</span>
            <ChevronsUpDown size={12} className="shrink-0 text-[var(--muted)]" />
          </>
        )}
      </button>

      {/* A true overlay — one of the few places a shadow is correct. */}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-lg)]">
          <span className="eyebrow px-2 py-1">Workspaces</span>
          {memberships.map((m) => (
            <button
              key={m.orgId}
              onClick={() => switchTo(m.orgId)}
              disabled={busy}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[var(--text-sm)] transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-60"
            >
              <span className="truncate">{m.orgName}</span>
              {m.orgId === orgId && <Check size={14} className="shrink-0 text-[var(--accent)]" />}
            </button>
          ))}

          <div className="my-1 border-t border-[var(--border)]" />

          {creating ? (
            <div className="flex flex-col gap-1.5 p-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createWorkspace()}
                placeholder="Workspace name"
                className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[var(--text-sm)] outline-none focus:border-[var(--border-strong)]"
              />
              <button
                onClick={createWorkspace}
                disabled={busy || !newName.trim()}
                className="rounded-[var(--radius-sm)] bg-[var(--accent-solid)] px-2 py-1.5 text-[var(--text-sm)] font-medium text-[var(--accent-solid-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[var(--text-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)]"
            >
              <Plus size={14} /> New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The nav itself. Shared by the desktop rail and the mobile drawer so the two
 * can't drift — the drawer is never "collapsed", since a slide-over that
 * collapses to icons is just a smaller problem.
 */
function SidebarBody({
  orgId,
  orgName,
  memberships,
  collapsed,
  canManageAgents,
  onToggleCollapse,
  onNavigate,
}: {
  orgId: string;
  orgName: string;
  memberships: WorkspaceMembership[];
  collapsed: boolean;
  canManageAgents: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navItems.filter((item) => !item.requiresCanManageAgents || canManageAgents);

  return (
    <>
      <div className={clsx("flex items-center", collapsed ? "flex-col gap-2" : "justify-between px-2")}>
        {!collapsed ? (
          <span className="flex items-center gap-2">
            <Logo size={18} className="text-[var(--accent)]" />
            <span className="text-[var(--text-md)] font-semibold tracking-tight">iRABU</span>
          </span>
        ) : (
          <Logo size={18} className="text-[var(--accent)]" />
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] md:flex"
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
        )}
      </div>

      <div className={clsx("mt-3", collapsed ? "" : "px-1")}>
        <WorkspaceSwitcher orgId={orgId} orgName={orgName} memberships={memberships} collapsed={collapsed} />
      </div>

      <nav className={clsx("mt-6 flex flex-col gap-0.5", collapsed && "w-full items-center")}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              data-active={active}
              onClick={onNavigate}
              className={clsx("nav-row", collapsed && "h-9 w-9 justify-center p-0")}
            >
              <item.icon size={16} className="shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/**
 * Two presentations of one nav. Below `md` the rail is removed from the layout
 * entirely and reappears as an off-canvas drawer — a 224px fixed column beside
 * the content is wider than a third of a phone screen, which is what forced the
 * whole page into horizontal scroll.
 */
export function Sidebar({
  orgId,
  orgName,
  memberships,
  canManageAgents,
  mobileOpen = false,
  onCloseMobile,
}: {
  orgId: string;
  orgName: string;
  memberships: WorkspaceMembership[];
  canManageAgents: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  // Close the drawer on Escape, and stop the page behind it from scrolling.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseMobile?.();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen, onCloseMobile]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      <aside
        className={clsx(
          "hidden shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] p-3 transition-[width] duration-150 md:flex",
          collapsed ? "w-14 items-center" : "w-56",
        )}
      >
        <SidebarBody
          orgId={orgId}
          orgName={orgName}
          memberships={memberships}
          collapsed={collapsed}
          canManageAgents={canManageAgents}
          onToggleCollapse={toggle}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-[var(--scrim)]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[82vw] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] p-3 shadow-[var(--shadow-lg)]"
          >
            <SidebarBody
              orgId={orgId}
              orgName={orgName}
              memberships={memberships}
              collapsed={false}
              canManageAgents={canManageAgents}
              onNavigate={onCloseMobile}
            />
          </aside>
        </div>
      )}
    </>
  );
}
