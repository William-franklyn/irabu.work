import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { evalCaseSchema } from "@/lib/agents/types";

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
    .from("agent_eval_cases")
    .select("id, prompt, expected_criteria, position")
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId)
    .order("position");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cases: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = evalCaseSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const supabase = await createClient();

  const { count } = await supabase
    .from("agent_eval_cases")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", id);

  const { data, error } = await supabase
    .from("agent_eval_cases")
    .insert({
      agent_id: id,
      organization_id: auth.orgId,
      prompt: parsed.data.prompt,
      expected_criteria: parsed.data.expectedCriteria,
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create eval case" }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
