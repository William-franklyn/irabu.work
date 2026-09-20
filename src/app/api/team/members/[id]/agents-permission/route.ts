import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ canManageAgents: z.boolean() });

// Owner/admin only — who may build/publish agents is a separate grant from
// role, exactly like sensitive_access_approved (see that route). Lives on
// memberships, not profiles, for the same cross-org reason: approval in one
// workspace has nothing to do with another.
//
// memberships has no UPDATE policy for the authenticated role at all (only
// select), so this goes through the service-role client like every other
// membership mutation — the auth.role check above is what makes that safe.
// protect_agents_permission() (041_agents_core.sql) is the defense-in-depth
// layer: it trusts a service-role write (no JWT, nothing to check) but
// blocks a direct, RLS-scoped write using someone's own session unless
// they're actually an owner/admin of that specific organization.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role === "member") {
    return NextResponse.json({ error: "Only owners and admins can grant Agents Lab access" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("memberships")
    .update({ can_manage_agents: parsed.data.canManageAgents })
    .eq("organization_id", auth.orgId)
    .eq("user_id", id)
    .select("user_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
