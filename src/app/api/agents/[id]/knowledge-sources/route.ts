import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { knowledgeWeightSchema } from "@/lib/agents/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_knowledge_sources")
    .select("source_id, weight, knowledge_sources(id, name)")
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attached = (data ?? []).map((row) => {
    const source = Array.isArray(row.knowledge_sources) ? row.knowledge_sources[0] : row.knowledge_sources;
    return { sourceId: row.source_id, weight: row.weight, name: source?.name ?? "Unknown source" };
  });

  return NextResponse.json({ attached });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = knowledgeWeightSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const supabase = await createClient();

  // Confirm the source actually belongs to this org before attaching it —
  // the FK alone would accept any source_id the RLS-scoped insert can see,
  // and RLS's is_member_of only proves org membership somewhere, not that
  // this specific source is in the agent's own organization.
  const { data: source } = await supabase
    .from("knowledge_sources")
    .select("id")
    .eq("id", parsed.data.sourceId)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "Knowledge source not found" }, { status: 404 });

  const { error } = await supabase.from("agent_knowledge_sources").upsert(
    {
      agent_id: id,
      source_id: parsed.data.sourceId,
      organization_id: auth.orgId,
      weight: parsed.data.weight,
    },
    { onConflict: "agent_id,source_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
