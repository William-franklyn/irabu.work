import {
  LayoutDashboard,
  MessagesSquare,
  BookOpen,
  Zap,
  ClipboardList,
  Wallet,
  Users,
  Settings,
  Bot,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Gated nav items check this against the signed-in member's permissions
  // before being shown — see Sidebar.tsx. A generic flag rather than a
  // one-off `if` so a future gated item needs no new plumbing.
  requiresCanManageAgents?: boolean;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Chat", href: "/assistant", icon: MessagesSquare },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen },
  { label: "Automations", href: "/automations", icon: Zap },
  { label: "Forms", href: "/forms", icon: ClipboardList },
  { label: "Agents Lab", href: "/agents", icon: Bot, requiresCanManageAgents: true },
  { label: "Finance", href: "/finance", icon: Wallet },
  { label: "Team", href: "/team", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
];
