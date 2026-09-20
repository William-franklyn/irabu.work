import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeBootstrap } from "./bootstrap";

export const VIEW_AS_COOKIE = "view_as_role";
export const ACTIVE_ORG_COOKIE = "active_org_id";
type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { owner: 2, admin: 1, member: 0 };

export interface WorkspaceMembership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface AuthContext {
  userId: string;
  orgId: string;
  orgName: string;
  role: Role;
  realRole: Role;
  viewingAs: boolean;
  fullName: string | null;
  memberships: WorkspaceMembership[];
  canManageAgents: boolean;
}

type MembershipRow = {
  organization_id: string;
  role: Role;
  can_manage_agents: boolean;
  organizations: { name: string } | { name: string }[] | null;
};

function toMembership(row: MembershipRow): WorkspaceMembership {
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  return { orgId: row.organization_id, orgName: org?.name ?? "Workspace", role: row.role };
}

async function resolveViewAsRole(realRole: Role): Promise<{ role: Role; viewingAs: boolean }> {
  const store = await cookies();
  const previewed = store.get(VIEW_AS_COOKIE)?.value as Role | undefined;

  // Only a real owner/admin can preview a role, and only a *lower* one —
  // this changes what the UI shows them, never what the membership row
  // actually says, so it can't be used to escalate privilege for anyone,
  // including whoever set the cookie.
  if (previewed && previewed in ROLE_RANK && ROLE_RANK[previewed] < ROLE_RANK[realRole]) {
    return { role: previewed, viewingAs: true };
  }
  return { role: realRole, viewingAs: false };
}

async function resolveAuthContext(
  userId: string,
  fullName: string | null,
  membershipRows: MembershipRow[],
): Promise<AuthContext | null> {
  if (membershipRows.length === 0) return null;

  const memberships = membershipRows.map(toMembership);
  const store = await cookies();
  const activeOrgId = store.get(ACTIVE_ORG_COOKIE)?.value;
  const activeIndex = membershipRows.findIndex((r) => r.organization_id === activeOrgId);
  const activeRow = activeIndex >= 0 ? membershipRows[activeIndex] : membershipRows[0];
  const active = memberships[activeIndex >= 0 ? activeIndex : 0];

  const { role, viewingAs } = await resolveViewAsRole(active.role);

  return {
    userId,
    orgId: active.orgId,
    orgName: active.orgName,
    role,
    realRole: active.role,
    viewingAs,
    fullName,
    memberships,
    canManageAgents: activeRow.can_manage_agents,
  };
}

async function loadMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ fullName: string | null; rows: MembershipRow[] }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();

  const { data: rows } = await supabase
    .from("memberships")
    .select("organization_id, role, can_manage_agents, organizations(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return { fullName: profile?.full_name ?? null, rows: (rows as MembershipRow[]) ?? [] };
}

/**
 * Signup only calls /api/auth/bootstrap directly when Supabase returns a
 * session immediately — if this project requires email confirmation, no
 * session comes back at signup time, bootstrap never runs, and a since-
 * confirmed user would otherwise be stuck authenticated with no workspace
 * and no way forward (re-submitting /signup with the same email doesn't
 * create a second account). SignUpForm stashes fullName/orgName/inviteToken
 * as auth user_metadata precisely so this can complete the deferred
 * bootstrap the first time such a user is resolved post-confirmation.
 * A no-op for every already-onboarded user (the common case) — one cheap
 * existence check via the service-role client, since there's no select
 * policy on profiles for a caller checking their own not-yet-existing row.
 */
async function ensureBootstrapped(
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const fullName = typeof metadata.fullName === "string" && metadata.fullName ? metadata.fullName : null;
  if (!fullName) return;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (existing) return;

  await completeBootstrap({
    userId,
    fullName,
    orgName: typeof metadata.orgName === "string" ? metadata.orgName : undefined,
    inviteToken: typeof metadata.inviteToken === "string" ? metadata.inviteToken : undefined,
  });
}

/**
 * Resolves the signed-in user's active workspace/role for a server component
 * or route handler. Redirects to /login if there's no session, or /signup if
 * they're authenticated but belong to no workspace yet — callers in route
 * handlers that need a 401 instead should use `requireAuthApi`.
 */
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  await ensureBootstrapped(user.id, user.user_metadata ?? {});

  const { fullName, rows } = await loadMemberships(supabase, user.id);
  const ctx = await resolveAuthContext(user.id, fullName, rows);
  if (!ctx) redirect("/signup");

  return ctx;
}

export async function requireAuthApi(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  await ensureBootstrapped(user.id, user.user_metadata ?? {});

  const { fullName, rows } = await loadMemberships(supabase, user.id);
  return await resolveAuthContext(user.id, fullName, rows);
}
