import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("status")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (agent.status !== "archived") {
    return NextResponse.json({ error: "Agent is not archived" }, { status: 400 });
  }

  const { error } = await supabase.from("agents").update({ status: "draft" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
