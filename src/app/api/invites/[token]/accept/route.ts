import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/guard";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { token } = await params;
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("org_invites")
    .select("id, organization_id, role, grant_agents_access, redeemed_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite || invite.redeemed_at) {
    return NextResponse.json({ error: "Invite is invalid or already used" }, { status: 400 });
  }

  const { data: existingMembership } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", invite.organization_id)
    .maybeSingle();

  if (!existingMembership) {
    const { error: membershipError } = await admin.from("memberships").insert({
      user_id: user.id,
      organization_id: invite.organization_id,
      role: invite.role,
      can_manage_agents: invite.grant_agents_access,
    });
    if (membershipError) {
      return NextResponse.json({ error: "Could not join workspace" }, { status: 500 });
    }
  } else if (invite.grant_agents_access) {
    // Upgrade-only: an invite can grant the permission to someone already in
    // the workspace, never revoke it — that stays a deliberate Team-page
    // action, not a side effect of redeeming an unrelated invite link.
    await admin
      .from("memberships")
      .update({ can_manage_agents: true })
      .eq("id", existingMembership.id);
  }

  await admin
    .from("org_invites")
    .update({ redeemed_at: new Date().toISOString() })
    .eq("id", invite.id);

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, invite.organization_id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });

  return NextResponse.json({ ok: true, organizationId: invite.organization_id });
}
