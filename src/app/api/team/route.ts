import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  const [{ data: membershipRows }, { data: invites }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, sensitive_access_approved, can_manage_agents, created_at, profiles(id, full_name, persona_verified_at)")
      .eq("organization_id", auth.orgId)
      .order("created_at"),
    supabase
      .from("org_invites")
      .select("id, email, role, token, created_at")
      .eq("organization_id", auth.orgId)
      .is("redeemed_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const members = (membershipRows ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: profile?.id,
      full_name: profile?.full_name ?? null,
      role: row.role,
      persona_verified: Boolean(profile?.persona_verified_at),
      sensitive_access_approved: row.sensitive_access_approved,
      can_manage_agents: row.can_manage_agents,
    };
  });

  return NextResponse.json({ members, invites: invites ?? [] });
}
