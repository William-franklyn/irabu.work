import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

// Revocation isn't a self-escalation risk the way minting is (it can only
// narrow access), so the regular RLS-scoped client is fine here — unlike
// POST /api-keys, which must use the service-role client.
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, keyId } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
