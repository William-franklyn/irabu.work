import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({ weight: z.number().min(0).max(5) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id, sourceId } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_knowledge_sources")
    .update({ weight: parsed.data.weight })
    .eq("agent_id", id)
    .eq("source_id", sourceId)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, sourceId } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_knowledge_sources")
    .delete()
    .eq("agent_id", id)
    .eq("source_id", sourceId)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
